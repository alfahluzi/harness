/**
 * `puna plugin dev [<name>] [--dir <dir>] [--backend <url>] [--no-warm]`
 *
 * Watches `<dir>/.puna/plugins/` recursively (or one plugin), debounces
 * ~150 ms, then re-validates the manifest and warms the backend's UI-bundle
 * route so bundling errors surface in the terminal. The backend being down is
 * a warning, never a crash — the watcher keeps running until SIGINT (exit 0).
 *
 * Default backend URL: `http://localhost:<PORT ?? 3001>` (backend default port,
 * see backend/src/server.ts); override with `--backend` or `PUNA_BACKEND_URL`.
 */
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import { assertValidPluginName, flagBool, flagString, parseArgs } from "./args";
import { CommandError, UsageError } from "./errors";
import {
	configDirOf,
	pluginsDirOf,
	readManifest,
	resolveWorkspaceRoot,
	uiCapabilitiesOf,
	type LoadedManifest,
} from "./workspace";

const DEBOUNCE_MS = 150;
const FETCH_TIMEOUT_MS = 8000;
const ERROR_BODY_LIMIT = 300;
const IGNORED_SEGMENTS = new Set(["node_modules", ".git"]);

export interface DevOptions {
	name?: string;
	root: string;
	backend: string;
	warm: boolean;
}

export function defaultBackendUrl(): string {
	if (process.env.PUNA_BACKEND_URL) return process.env.PUNA_BACKEND_URL;
	const port = process.env.PUNA_BACKEND_PORT ?? process.env.PORT ?? "3001";
	return `http://localhost:${port}`;
}

export function parseDevArgs(argv: readonly string[]): DevOptions {
	const parsed = parseArgs(argv, {
		boolean: ["no-warm"],
		string: ["dir", "backend"],
		maxPositionals: 1,
	});
	const name = parsed.positionals[0];
	if (name !== undefined) assertValidPluginName(name);

	const backendRaw = flagString(parsed, "backend") ?? defaultBackendUrl();
	let backend: string;
	try {
		backend = new URL(backendRaw).toString().replace(/\/$/, "");
	} catch {
		throw new UsageError(`--backend is not a valid URL: ${backendRaw}`);
	}

	return {
		...(name !== undefined ? { name } : {}),
		root: resolveWorkspaceRoot(flagString(parsed, "dir")),
		backend,
		warm: !flagBool(parsed, "no-warm"),
	};
}

export function isIgnored(relPath: string): boolean {
	return relPath
		.split(/[\\/]/)
		.some((segment) => IGNORED_SEGMENTS.has(segment));
}

export function pluginOf(relPath: string): string | undefined {
	const [first] = relPath.split(/[\\/]/);
	return first !== undefined && first.length > 0 ? first : undefined;
}

/**
 * Minimal structural view of `fs.watch`'s return value — bun-types ships a
 * narrower `FSWatcher` than Node's, but `close()` + `on("error")` exist at
 * runtime in both Bun and Node.
 */
interface WatchHandle {
	close(): void;
	on(event: "error", listener: (error: Error) => void): unknown;
}

export async function devCommand(argv: readonly string[]): Promise<number> {
	const options = parseDevArgs(argv);
	const pluginsRoot = pluginsDirOf(options.root);

	if (!existsSync(pluginsRoot)) {
		throw new CommandError(
			`no plugins directory at ${pluginsRoot} (run \`puna plugin create <name>\` first)`,
		);
	}

	const watchTarget = options.name ? join(pluginsRoot, options.name) : pluginsRoot;
	if (options.name && !existsSync(watchTarget)) {
		throw new CommandError(`plugin directory not found: ${watchTarget}`);
	}

	console.log(`[dev] watching ${watchTarget}`);
	console.log(
		`[dev] backend ${options.backend} · ${options.warm ? "warm (re-bundles on change)" : "no-warm (file changes only)"}`,
	);
	console.log("[dev] Ctrl-C to stop");

	const pending = new Map<string, Set<string>>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let flushing: Promise<void> = Promise.resolve();

	const schedule = (plugin: string, file: string): void => {
		let files = pending.get(plugin);
		if (!files) {
			files = new Set();
			pending.set(plugin, files);
		}
		if (file.length > 0) files.add(file);
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			const batch = new Map(pending);
			pending.clear();
			flushing = flushing.then(() => flush(batch, options, pluginsRoot));
		}, DEBOUNCE_MS);
	};

	let watcher: WatchHandle;
	try {
		watcher = watch(watchTarget, { recursive: true }, (_event, filename) => {
			const rel = typeof filename === "string" ? filename : "";
			if (rel.length > 0 && isIgnored(rel)) return;
			const plugin = options.name ?? pluginOf(rel);
			if (!plugin) return;
			schedule(plugin, rel);
		}) as unknown as WatchHandle;
	} catch (error) {
		throw new CommandError(
			`failed to watch ${watchTarget}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	watcher.on("error", (error) => {
		console.warn(`[dev] watch error: ${error.message}`);
	});

	let stopping = false;
	const stop = (): void => {
		if (stopping) return;
		stopping = true;
		if (timer) clearTimeout(timer);
		try {
			watcher.close();
		} catch {
			// already closed
		}
		console.log("");
		console.log("[dev] stopped");
		process.exit(0);
	};
	// `on` (not `once`): the root dispatcher forwards SIGINT in addition to the
	// terminal's process-group delivery, so the handler must be idempotent.
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);

	// Keep the process alive until a signal arrives; `process.exit` in `stop`.
	await new Promise<never>(() => {});
	return 0;
}

async function flush(
	batch: Map<string, Set<string>>,
	options: DevOptions,
	pluginsRoot: string,
): Promise<void> {
	for (const [plugin, files] of batch) {
		await refreshPlugin(plugin, [...files], options, pluginsRoot);
	}
}

async function refreshPlugin(
	plugin: string,
	files: string[],
	options: DevOptions,
	pluginsRoot: string,
): Promise<void> {
	const pluginDir = join(pluginsRoot, plugin);
	if (!existsSync(pluginDir)) {
		console.log(`[dev] ${plugin}: removed`);
		return;
	}

	if (!options.warm) {
		const list = files.length > 0 ? files.join(", ") : "(directory change)";
		console.log(`[dev] ${plugin}: changed ${list}`);
		return;
	}

	let loaded: LoadedManifest;
	try {
		loaded = await readManifest(pluginDir);
	} catch (error) {
		console.warn(`[dev] ${plugin}: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	await warmBackend(options.backend, configDirOf(options.root), loaded, files);
}

async function warmBackend(
	backend: string,
	configDir: string,
	loaded: LoadedManifest,
	files: string[],
): Promise<void> {
	const { manifest } = loaded;
	const id = manifest.id;
	const base = `${backend}/api/plugins/${encodeURIComponent(id)}?configDir=${encodeURIComponent(configDir)}`;

	// Detail first: surfaces manifest/parse errors the backend's scan noticed.
	const detail = await tryFetch(base);
	if (detail.kind === "unreachable") {
		warnUnreachable(backend, detail.reason, files);
		return;
	}
	if (!detail.response.ok) {
		console.warn(`[dev] ${id}: detail ${detail.response.status} — ${await readBody(detail.response)}`);
	} else {
		console.log(`[dev] ${id}: detail 200 (manifest accepted)`);
	}

	for (const { key, cap } of uiCapabilitiesOf(manifest)) {
		const bundleUrl = `${backend}/api/plugins/${encodeURIComponent(id)}/ui-bundle?configDir=${encodeURIComponent(configDir)}`;
		const result = await tryFetch(bundleUrl);
		if (result.kind === "unreachable") {
			warnUnreachable(backend, result.reason, files);
			return;
		}
		if (!result.response.ok) {
			console.warn(
				`[dev] ${id} ${key} (${cap.entry}) → ${result.response.status} — ${await readBody(result.response)}`,
			);
			continue;
		}
		const bytes = new Uint8Array(await result.response.arrayBuffer()).byteLength;
		console.log(`[dev] ${id} ${key} (${cap.entry}) → 200 (${bytes} bytes)`);
	}

	if (files.length > 0) {
		console.log(`[dev] ${id}: changed ${files.join(", ")}`);
	}
}

type FetchResult = { kind: "ok"; response: Response } | { kind: "unreachable"; reason: string };

async function tryFetch(url: string): Promise<FetchResult> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		return { kind: "ok", response };
	} catch (error) {
		return { kind: "unreachable", reason: error instanceof Error ? error.message : String(error) };
	}
}

async function readBody(response: Response): Promise<string> {
	try {
		const text = (await response.text()).replace(/\s+/g, " ").trim();
		return text.length > ERROR_BODY_LIMIT ? `${text.slice(0, ERROR_BODY_LIMIT)}…` : text;
	} catch {
		return "(unreadable body)";
	}
}

function warnUnreachable(backend: string, reason: string, files: string[]): void {
	console.warn(`[dev] backend unreachable at ${backend} (${reason}) — still watching`);
	if (files.length > 0) console.warn(`[dev] changed: ${files.join(", ")}`);
}

/** Help text for `puna plugin dev --help`. */
export const DEV_USAGE = `Usage: puna plugin dev [<name>] [options]

Watch plugin sources, re-validate plugin.json on change, and warm the
backend's UI-bundle route (GET /api/plugins/:id/ui-bundle) so TypeScript
bundling errors surface here.

Options:
  --dir <dir>         Workspace root (default: nearest .puna/ ancestor of cwd)
  --backend <url>     Backend base URL (default: http://localhost:3001,
                      env: PUNA_BACKEND_URL / PUNA_BACKEND_PORT / PORT)
  --no-warm           Skip HTTP re-bundling; only report changed files
  -h, --help          Show this help

Exit codes: 0 success (SIGINT exits 0) · 1 runtime failure · 2 invalid args
`;
