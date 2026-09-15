/**
 * `puna plugin build [<name>] [--dir <dir>] [--minify] [--update-manifest] [--budget-kb <n>]`
 *
 * Bundles every declared UI capability with `Bun.build` (browser ESM, React +
 * TanStack Router external, same externals list as the backend ui-bundle
 * route) and emits `<basename>.js` next to each entry. Reports raw + gzip
 * bytes per capability and enforces a gzip budget (default 50 KB).
 *
 * `--update-manifest` rewrites each built capability's `entry` in plugin.json
 * to the emitted relative `.js` path, which makes the backend serve the
 * pre-built file as-is (see backend/src/modules/plugins/route.ts).
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { PluginManifest as PluginManifestSchema } from "@puna/sdk-shared";
import { assertValidPluginName, flagBool, flagString, parseArgs } from "./args";
import { CommandError, UsageError } from "./errors";
import {
	formatManifestIssues,
	pluginsDirOf,
	readManifest,
	resolveWorkspaceRoot,
	uiCapabilitiesOf,
	writeManifest,
	type LoadedManifest,
	type UiCapabilityKey,
} from "./workspace";

/** Must match `backend/src/modules/plugins/route.ts` (Bun.build external list). */
export const BUNDLE_EXTERNALS = [
	"react",
	"react-dom",
	"react/jsx-runtime",
	"react-dom/client",
	"@tanstack/react-router",
] as const;

export const DEFAULT_BUDGET_KB = 50;

export interface BuildOptions {
	name?: string;
	root: string;
	minify: boolean;
	updateManifest: boolean;
	budgetKb: number;
}

export function parseBuildArgs(argv: readonly string[]): BuildOptions {
	const parsed = parseArgs(argv, {
		boolean: ["minify", "update-manifest"],
		string: ["dir", "budget-kb"],
		maxPositionals: 1,
	});
	const name = parsed.positionals[0];
	if (name !== undefined) assertValidPluginName(name);

	let budgetKb = DEFAULT_BUDGET_KB;
	const budgetRaw = flagString(parsed, "budget-kb");
	if (budgetRaw !== undefined) {
		const parsedBudget = Number(budgetRaw);
		if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
			throw new UsageError(`--budget-kb must be a positive number (got "${budgetRaw}")`);
		}
		budgetKb = parsedBudget;
	}

	return {
		...(name !== undefined ? { name } : {}),
		root: resolveWorkspaceRoot(flagString(parsed, "dir")),
		minify: flagBool(parsed, "minify"),
		updateManifest: flagBool(parsed, "update-manifest"),
		budgetKb,
	};
}

interface BuiltEntry {
	/** Path relative to the plugin dir, e.g. `ui/index.js`. */
	outRel: string;
	raw: number;
	gzip: number;
	prebuilt: boolean;
}

interface BuildPlan {
	key: UiCapabilityKey;
	entry: string;
	built: BuiltEntry;
	shared: boolean;
}

export async function buildCommand(argv: readonly string[]): Promise<number> {
	const options = parseBuildArgs(argv);
	const pluginsRoot = pluginsDirOf(options.root);
	if (!existsSync(pluginsRoot)) {
		throw new CommandError(
			`no plugins directory at ${pluginsRoot} (run \`puna plugin create <name>\` first)`,
		);
	}

	const pluginDir = resolvePluginDir(pluginsRoot, options.name);
	const loaded = await readManifest(pluginDir);
	const uiCaps = uiCapabilitiesOf(loaded.manifest);

	if (uiCaps.length === 0) {
		console.log(
			`[build] ${loaded.manifest.id}: no UI capabilities declared (chatRenderers/toolUi/leftBar/footerBar) — nothing to build`,
		);
		return 0;
	}

	console.log(`[build] ${loaded.manifest.id} (${pluginDir})`);

	const builtByEntry = new Map<string, BuiltEntry>();
	const plans: BuildPlan[] = [];
	let totalRaw = 0;
	let totalGzip = 0;

	for (const { key, cap } of uiCaps) {
		const absEntry = join(pluginDir, cap.entry);
		let built = builtByEntry.get(absEntry);
		const shared = built !== undefined;
		if (!built) {
			built = await buildEntry(pluginDir, absEntry, options.minify);
			builtByEntry.set(absEntry, built);
			totalRaw += built.raw;
			totalGzip += built.gzip;
		}
		plans.push({ key, entry: cap.entry, built, shared });

		const inRel = displayRel(cap.entry, cap.entry);
		const outRel = displayRel(cap.entry, built.outRel);
		const note = shared ? " (shared entry; counted once)" : "";
		console.log(
			`  ${key.padEnd(14)} ${inRel} → ${outRel}  ${formatKb(built.raw)} raw / ${formatKb(built.gzip)} gzip${note}`,
		);
	}

	console.log(
		`  ${"total".padEnd(14)} ${formatKb(totalRaw)} raw / ${formatKb(totalGzip)} gzip ` +
			`(${formatKb(totalGzip, " KB")}) · budget ${options.budgetKb} KB`,
	);

	const totalGzipKb = totalGzip / 1024;
	if (totalGzipKb > options.budgetKb) {
		throw new CommandError(
			`gzip total ${totalGzipKb.toFixed(2)} KB exceeds budget ${options.budgetKb} KB ` +
				`— use --budget-kb <n> to relax`,
		);
	}

	if (options.updateManifest) {
		await updateManifestEntries(loaded, plans);
	}

	console.log(`[build] ok${options.minify ? " (minified)" : ""}`);
	return 0;
}

async function buildEntry(
	pluginDir: string,
	absEntry: string,
	minify: boolean,
): Promise<BuiltEntry> {
	if (!existsSync(absEntry)) {
		throw new CommandError(`UI entry not found: ${absEntry}`);
	}

	const ext = absEntry.slice(absEntry.lastIndexOf(".")).toLowerCase();
	if (ext === ".js" || ext === ".mjs") {
		// Already pre-built (prod mode): the backend serves it as-is.
		const bytes = new Uint8Array(await Bun.file(absEntry).arrayBuffer());
		return {
			outRel: toPluginRel(pluginDir, absEntry),
			raw: bytes.byteLength,
			gzip: gzipSize(bytes),
			prebuilt: true,
		};
	}

	const result = await Bun.build({
		entrypoints: [absEntry],
		target: "browser",
		format: "esm",
		external: [...BUNDLE_EXTERNALS],
		minify,
		sourcemap: "none",
		naming: "[name].js",
		outdir: dirname(absEntry),
	});

	if (!result.success || result.outputs.length === 0) {
		const logs = result.logs.map((log) => log.message).join("; ");
		throw new CommandError(`Bun.build failed for ${absEntry}: ${logs.length > 0 ? logs : "no output"}`);
	}

	const artifact = result.outputs[0];
	if (!artifact) {
		throw new CommandError(`Bun.build produced no artifact for ${absEntry}`);
	}
	const outPath = artifact.path;
	const bytes = new Uint8Array(await Bun.file(outPath).arrayBuffer());
	return {
		outRel: toPluginRel(pluginDir, outPath),
		raw: bytes.byteLength,
		gzip: gzipSize(bytes),
		prebuilt: false,
	};
}

function gzipSize(bytes: Uint8Array<ArrayBuffer>): number {
	return Bun.gzipSync(bytes).byteLength;
}

function toPluginRel(pluginDir: string, absPath: string): string {
	return relative(pluginDir, absPath).split(/[\\/]/).join("/");
}

/** Preserve the archetype's `./`-prefixed style in manifests. */
function displayRel(original: string, rel: string): string {
	return original.startsWith("./") ? `./${rel.replace(/^\.\//, "")}` : rel;
}

function formatKb(bytes: number, unit = ""): string {
	if (unit === " KB") return `${(bytes / 1024).toFixed(2)} KB`;
	return `${bytes} B`;
}

function resolvePluginDir(pluginsRoot: string, name?: string): string {
	if (name !== undefined) {
		const dir = join(pluginsRoot, name);
		if (!existsSync(join(dir, "plugin.json"))) {
			throw new CommandError(`plugin not found: ${dir} (missing plugin.json)`);
		}
		return dir;
	}

	const candidates = readdirSync(pluginsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(pluginsRoot, entry.name, "plugin.json")))
		.map((entry) => entry.name);

	if (candidates.length === 0) {
		throw new CommandError(`no plugins found under ${pluginsRoot}`);
	}
	if (candidates.length > 1) {
		throw new CommandError(
			`multiple plugins found under ${pluginsRoot}: ${candidates.join(", ")} — pass <name>`,
		);
	}
	const [only] = candidates;
	if (only === undefined) throw new CommandError(`no plugins found under ${pluginsRoot}`);
	return join(pluginsRoot, only);
}

async function updateManifestEntries(loaded: LoadedManifest, plans: BuildPlan[]): Promise<void> {
	const capabilities = loaded.raw.capabilities;
	if (capabilities === null || typeof capabilities !== "object" || Array.isArray(capabilities)) {
		return;
	}
	let changed = false;
	for (const plan of plans) {
		const cap = (capabilities as Record<string, unknown>)[plan.key];
		if (cap === null || typeof cap !== "object" || Array.isArray(cap)) continue;
		const record = cap as Record<string, unknown>;
		const current = typeof record.entry === "string" ? record.entry : "";
		const next = displayRel(current, plan.built.outRel);
		if (current === next) continue;
		record.entry = next;
		changed = true;
		console.log(`  ${plan.key.padEnd(14)} plugin.json entry → ${next}`);
	}

	if (!changed) {
		console.log("  plugin.json already points at the built bundle(s)");
		return;
	}

	const validated = PluginManifestSchema.safeParse(loaded.raw);
	if (!validated.success) {
		throw new CommandError(
			`refusing to write plugin.json — manifest would become invalid: ${formatManifestIssues(validated.error)}`,
		);
	}
	await writeManifest(loaded);
	console.log(`  updated ${loaded.path}`);
}

/** Help text for `puna plugin build --help`. */
export const BUILD_USAGE = `Usage: puna plugin build [<name>] [options]

Bundle each declared UI capability of one plugin (or the only plugin in the
workspace) to a sibling <basename>.js with React + @tanstack/react-router
external, mirroring the backend's dev ui-bundle route.

Options:
  --dir <dir>         Workspace root (default: nearest .puna/ ancestor of cwd)
  --minify            Minify the emitted bundle (default: off)
  --update-manifest   Rewrite each capability's entry to the emitted .js path
  --budget-kb <n>     Gzip budget in KB for the whole plugin (default: 50)
  -h, --help          Show this help

Exit codes: 0 success · 1 runtime failure or budget exceeded · 2 invalid args
`;
