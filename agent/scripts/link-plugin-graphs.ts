/**
 * link-plugin-graphs.ts — Fase 6 (F6-T1).
 *
 * Makes plugin-contributed LangGraph subgraphs visible to the LangGraph dev
 * server without the agent knowing anything about the plugin layer layout:
 *
 *   1. best-effort filesystem scan of `plugin.json` manifests across the three
 *      plugin layers (workspace-local → workspace-global → system-global,
 *      later overrides earlier on directory-name collision),
 *   2. symlink `agent/.plugins/<pluginId>` → the plugin directory (so graph
 *      modules keep resolving their own relative imports), and
 *   3. rewrite `agent/langgraph.json` with one entry per graph, keyed by the
 *      shared naming policy (`resolveGraphKey` in `packages/sdk-shared`).
 *
 * The backend HTTP API is deliberately NOT consulted: `dev.sh` runs this
 * before the LangGraph server, while the backend may not be up yet.
 * Best-effort by design — invalid manifests warn + skip, never throw, and a
 * workspace with zero plugins is a success. Only real write failures exit
 * non-zero.
 */
import { existsSync, type Dirent } from "node:fs";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { resolveGraphKey } from "../../packages/sdk-shared/src/graph-key.ts";

const PREFIX = "[link-plugin-graphs]";
const MARKER = "plugin.json";
const BASE_GRAPH_KEY = "graph";
const BASE_GRAPH_VALUE = "./src/base/graph.ts:graph";
const DEFAULT_ENV = ".env";
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
const DOTDOT_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

function warn(message: string): void {
	console.warn(`${PREFIX} ${message}`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Locale-independent string compare (deterministic ordering). */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/** Normalize a manifest-relative entry to POSIX form without a leading `./`. */
function normalizeEntry(entry: string): string {
	return entry.split("\\").join("/").replace(/^\.\//, "");
}

/** Mirrors `safeRelativePath` from the manifest schema (no zod in the agent). */
function isSafeEntry(entry: string): boolean {
	if (entry.includes("\0")) return false;
	if (isAbsolute(entry) || entry.startsWith("\\")) return false;
	if (WINDOWS_DRIVE_RE.test(entry)) return false;
	return !DOTDOT_RE.test(entry);
}

/** One graph declaration from a manifest's `capabilities.graphs[]`. */
export interface PluginGraphSpec {
	/** Bare graph id from the manifest (`kebab-case`). */
	id: string;
	/** Relative module path from the plugin root, normalized (no `./`). */
	entry: string;
	/** Named export to load — defaults to `"graph"`. */
	export: string;
	/** Optional override for the un-namespaced name. */
	alias?: string;
	/** Optional explicit namespace; defaults to the plugin id. */
	namespace?: string;
}

export interface DiscoveredGraph {
	/** Manifest `id` (identity is the manifest, not the directory name). */
	pluginId: string;
	/** Absolute path to the plugin directory. */
	pluginDir: string;
	graph: PluginGraphSpec;
}

export interface DiscoverGraphPluginsOptions {
	/** Workspace-local config dir (the workspace's `.puna/` folder). */
	localDir?: string | null;
	/** Workspace-global config dir; its `plugins/` subdir is scanned. */
	workspaceGlobalDir?: string | null;
	/** System-global dir; its `plugins/` subdir is scanned. `undefined` → `~/.config/puna`. */
	systemDir?: string | null;
}

export interface DiscoverGraphPluginsResult {
	graphs: DiscoveredGraph[];
	/** Human-readable warnings for everything skipped (also emitted via console.warn). */
	warnings: string[];
}

/** Best-effort `globalConfigDir` lookup in `<configDir>/config.json`. */
async function readGlobalConfigDir(configDir: string): Promise<string | null> {
	const configPath = join(configDir, "config.json");
	if (!existsSync(configPath)) return null;
	try {
		const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
		const value = isPlainObject(parsed) ? parsed.globalConfigDir : undefined;
		return typeof value === "string" && value.length > 0 ? value : null;
	} catch (e) {
		warn(`cannot parse ${configPath}: ${errorMessage(e)}`);
		return null;
	}
}

/**
 * Layer scan. Returns plugin dirs keyed by directory name, later layers
 * overriding earlier ones: system-global → workspace-global → workspace-local.
 */
async function scanLayers(opts: DiscoverGraphPluginsOptions): Promise<Map<string, string>> {
	const localDir = opts.localDir ?? null;
	const workspaceGlobalDir =
		opts.workspaceGlobalDir === undefined
			? localDir
				? await readGlobalConfigDir(localDir)
				: null
			: opts.workspaceGlobalDir;
	const systemDir =
		opts.systemDir === undefined ? join(homedir(), ".config", "puna") : opts.systemDir;

	const layers: string[] = [];
	if (systemDir) layers.push(join(expandTilde(systemDir), "plugins"));
	if (workspaceGlobalDir) layers.push(join(expandTilde(workspaceGlobalDir), "plugins"));
	if (localDir) layers.push(join(expandTilde(localDir), "plugins"));

	const byDirName = new Map<string, string>();
	for (const layerDir of layers) {
		if (!existsSync(layerDir)) continue;
		let entries: Dirent[];
		try {
			entries = await readdir(layerDir, { withFileTypes: true });
		} catch (e) {
			warn(`cannot read ${layerDir}: ${errorMessage(e)}`);
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = join(layerDir, entry.name);
			if (!existsSync(join(dir, MARKER))) continue;
			byDirName.set(entry.name, dir);
		}
	}
	return byDirName;
}

/** Parse one plugin's `plugin.json` and collect its valid graph declarations. */
async function readPluginGraphs(
	pluginDir: string,
	record: (message: string) => void,
): Promise<DiscoveredGraph[]> {
	const manifestPath = join(pluginDir, MARKER);
	let manifest: unknown;
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (e) {
		record(`skipping ${pluginDir}: cannot read ${MARKER}: ${errorMessage(e)}`);
		return [];
	}
	if (!isPlainObject(manifest)) {
		record(`skipping ${pluginDir}: ${MARKER} must be a JSON object`);
		return [];
	}
	const pluginId = manifest.id;
	if (typeof pluginId !== "string" || pluginId.length === 0) {
		record(`skipping ${pluginDir}: ${MARKER} "id" must be a non-empty string`);
		return [];
	}
	const capabilities = manifest.capabilities;
	const rawGraphs = isPlainObject(capabilities) ? capabilities.graphs : undefined;
	if (!Array.isArray(rawGraphs)) return []; // not a graph plugin — nothing to register

	const graphs: DiscoveredGraph[] = [];
	for (const raw of rawGraphs) {
		if (!isPlainObject(raw)) {
			record(`skipping plugin ${pluginId}: graph entry must be an object`);
			continue;
		}
		const id = raw.id;
		if (typeof id !== "string" || id.length === 0) {
			record(`skipping plugin ${pluginId}: graph "id" must be a non-empty string`);
			continue;
		}
		const entry = raw.entry;
		if (typeof entry !== "string" || entry.length === 0) {
			record(`skipping plugin ${pluginId} graph "${id}": "entry" must be a non-empty string`);
			continue;
		}
		if (!isSafeEntry(entry)) {
			record(
				`skipping plugin ${pluginId} graph "${id}": "entry" must be a relative path without ".." segments: ${entry}`,
			);
			continue;
		}
		graphs.push({
			pluginId,
			pluginDir,
			graph: {
				id,
				entry: normalizeEntry(entry),
				export: typeof raw.export === "string" && raw.export.length > 0 ? raw.export : "graph",
				alias:
					typeof raw.alias === "string" && raw.alias.length > 0 ? raw.alias : undefined,
				namespace:
					typeof raw.namespace === "string" && raw.namespace.length > 0
						? raw.namespace
						: undefined,
			},
		});
	}
	return graphs;
}

/**
 * Best-effort plugin graph discovery — no HTTP, no zod.
 *
 * Invalid manifests / graph entries are skipped with a warning; a workspace
 * with zero graph plugins returns an empty list.
 */
export async function discoverGraphPlugins(
	opts: DiscoverGraphPluginsOptions = {},
): Promise<DiscoverGraphPluginsResult> {
	const warnings: string[] = [];
	const record = (message: string) => {
		warnings.push(message);
		warn(message);
	};

	const byDirName = await scanLayers(opts);
	const graphs: DiscoveredGraph[] = [];
	for (const [, pluginDir] of [...byDirName.entries()].sort(([a], [b]) => compare(a, b))) {
		graphs.push(...(await readPluginGraphs(pluginDir, record)));
	}
	return { graphs, warnings };
}

/** Shape written to `agent/langgraph.json`. */
export interface LangGraphConfigFile {
	graphs: Record<string, string>;
	env: string;
}

function byResolvedKey(a: DiscoveredGraph, b: DiscoveredGraph): number {
	return compare(
		resolveGraphKey(a.pluginId, a.graph).key,
		resolveGraphKey(b.pluginId, b.graph).key,
	);
}

/**
 * Build the `langgraph.json` payload.
 *
 * Base `graph` entry always comes first, then plugin keys sorted
 * alphabetically. Duplicate keys warn; the first (lowest key) wins. `env` is
 * preserved from the existing config when present, else defaults to `.env`.
 */
export function buildLangGraphConfig(
	existing: unknown,
	graphs: readonly DiscoveredGraph[],
): LangGraphConfigFile {
	const existingObj = isPlainObject(existing) ? existing : {};
	const env =
		typeof existingObj.env === "string" && existingObj.env.length > 0
			? existingObj.env
			: DEFAULT_ENV;

	const pluginEntries = new Map<string, string>();
	for (const entry of [...graphs].sort(byResolvedKey)) {
		const { key } = resolveGraphKey(entry.pluginId, entry.graph);
		if (pluginEntries.has(key)) {
			warn(`duplicate graph key "${key}" (plugin ${entry.pluginId}); keeping first registration`);
			continue;
		}
		const value = `./.plugins/${entry.pluginId}/${entry.graph.entry}:${entry.graph.export}`;
		pluginEntries.set(key, value);
	}

	const ordered: Record<string, string> = { [BASE_GRAPH_KEY]: BASE_GRAPH_VALUE };
	for (const key of [...pluginEntries.keys()].sort(compare)) {
		ordered[key] = pluginEntries.get(key)!;
	}
	return { graphs: ordered, env };
}

export interface LinkPluginGraphsOptions {
	/** Workspace config dir (`.puna/`); scanned at `<configDir>/plugins`. */
	configDir?: string | null;
	/** Repo `agent/` dir — `.plugins/` and `langgraph.json` live here. */
	agentDir: string;
	/** Workspace-global config dir; `null` disables the layer. */
	workspaceGlobalDir?: string | null;
	/** System-global dir; `null` disables the layer. */
	systemDir?: string | null;
	/** Log intended changes without touching the filesystem. */
	dryRun?: boolean;
	/** Suppress informational logs (warnings still print). */
	quiet?: boolean;
}

export interface RegisteredGraph {
	key: string;
	/** Value written to `langgraph.json` (`./.plugins/...:export`). */
	entry: string;
	pluginId: string;
}

export interface LinkPluginGraphsResult {
	registered: RegisteredGraph[];
	/** Graphs skipped because their entry file does not exist. */
	skipped: number;
	configPath: string;
}

/** Remove a pre-existing `.plugins/<id>` entry — symlinks or owned paths only. */
async function removeOwnedEntry(target: string, pluginsRoot: string): Promise<void> {
	let stats;
	try {
		stats = await lstat(target);
	} catch {
		return; // nothing at that path
	}
	const insidePlugins = target.startsWith(pluginsRoot + sep);
	if (!stats.isSymbolicLink() && !insidePlugins) {
		warn(`refusing to remove ${target}: not a symlink and outside ${pluginsRoot}`);
		return;
	}
	await rm(target, { recursive: true, force: true });
}

/** Parse an existing JSON file; missing/invalid → `null` (best effort). */
async function readJsonIfExists(path: string): Promise<unknown> {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (e) {
		warn(`cannot parse ${path}: ${errorMessage(e)}; rebuilding from defaults`);
		return null;
	}
}

/** Symlinks inside `.plugins/` that no longer belong to a discovered plugin. */
async function listStaleLinks(
	pluginsRoot: string,
	wanted: ReadonlyMap<string, string>,
): Promise<string[]> {
	if (!existsSync(pluginsRoot)) return [];
	let entries: Dirent[];
	try {
		entries = await readdir(pluginsRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	const stale: string[] = [];
	for (const entry of entries) {
		if (wanted.has(entry.name)) continue;
		if (entry.isSymbolicLink()) stale.push(join(pluginsRoot, entry.name));
	}
	return stale.sort(compare);
}

/** Collect the final, de-duplicated registration list in `langgraph.json` order. */
function collectRegistered(
	graphValues: Record<string, string>,
	graphs: readonly DiscoveredGraph[],
): RegisteredGraph[] {
	const seen = new Set<string>();
	const registered: RegisteredGraph[] = [];
	for (const entry of [...graphs].sort(byResolvedKey)) {
		const { key } = resolveGraphKey(entry.pluginId, entry.graph);
		if (seen.has(key)) continue;
		seen.add(key);
		const value = graphValues[key];
		if (typeof value !== "string") continue;
		registered.push({ key, entry: value, pluginId: entry.pluginId });
	}
	return registered;
}

/**
 * Discover plugin graphs, symlink the contributing plugin directories into
 * `<agentDir>/.plugins/`, and rewrite `<agentDir>/langgraph.json`.
 *
 * Idempotent: a second run produces byte-identical output. `dryRun` logs the
 * intended work without touching the filesystem.
 */
export async function linkPluginGraphs(
	opts: LinkPluginGraphsOptions,
): Promise<LinkPluginGraphsResult> {
	const agentDir = resolve(opts.agentDir);
	const dryRun = opts.dryRun === true;
	const quiet = opts.quiet === true;
	const log = (message: string) => {
		if (!quiet) console.log(`${PREFIX} ${message}`);
	};

	const pluginsRoot = join(agentDir, ".plugins");
	const configPath = join(agentDir, "langgraph.json");

	const { graphs } = await discoverGraphPlugins({
		localDir: opts.configDir ?? null,
		workspaceGlobalDir: opts.workspaceGlobalDir ?? null,
		systemDir: opts.systemDir ?? null,
	});

	// A declared graph only registers when its module actually exists, and one
	// plugin id maps to exactly one symlinked directory.
	const usable: DiscoveredGraph[] = [];
	const pluginDirs = new Map<string, string>();
	let skipped = 0;
	for (const entry of graphs) {
		const knownDir = pluginDirs.get(entry.pluginId);
		if (knownDir && knownDir !== entry.pluginDir) {
			skipped++;
			warn(
				`skipping plugin "${entry.pluginId}" at ${entry.pluginDir}: id already discovered at ${knownDir}`,
			);
			continue;
		}
		pluginDirs.set(entry.pluginId, entry.pluginDir);
		const absoluteEntry = join(entry.pluginDir, entry.graph.entry);
		if (!existsSync(absoluteEntry)) {
			skipped++;
			warn(
				`skipping graph "${entry.pluginId}.${entry.graph.id}": entry file not found: ${absoluteEntry}`,
			);
			continue;
		}
		usable.push(entry);
	}

	const existing = await readJsonIfExists(configPath);
	const config = buildLangGraphConfig(existing, usable);
	const configText = `${JSON.stringify(config, null, "\t")}\n`;

	// One directory symlink per contributing plugin, deterministic order.
	const wantedPlugins = new Map<string, string>();
	for (const entry of [...usable].sort(
		(a, b) => compare(a.pluginId, b.pluginId) || compare(a.graph.id, b.graph.id),
	)) {
		wantedPlugins.set(entry.pluginId, entry.pluginDir);
	}

	if (dryRun) {
		log(`dry-run: would write ${configPath} (${Object.keys(config.graphs).length} graph(s))`);
		for (const [pluginId, pluginDir] of wantedPlugins) {
			log(`dry-run: would link ${join(pluginsRoot, pluginId)} -> ${pluginDir}`);
		}
		for (const stale of await listStaleLinks(pluginsRoot, wantedPlugins)) {
			log(`dry-run: would remove stale link ${stale}`);
		}
	} else {
		await mkdir(pluginsRoot, { recursive: true });
		for (const [pluginId, pluginDir] of wantedPlugins) {
			const linkPath = join(pluginsRoot, pluginId);
			await removeOwnedEntry(linkPath, pluginsRoot);
			try {
				await symlink(pluginDir, linkPath, "dir");
			} catch (e) {
				throw new Error(`failed to symlink ${linkPath} -> ${pluginDir}: ${errorMessage(e)}`);
			}
			log(`linked ${linkPath} -> ${pluginDir}`);
		}
		for (const stale of await listStaleLinks(pluginsRoot, wantedPlugins)) {
			await rm(stale, { recursive: true, force: true });
			log(`removed stale link ${stale}`);
		}
		try {
			await writeFile(configPath, configText, "utf8");
		} catch (e) {
			throw new Error(`failed to write ${configPath}: ${errorMessage(e)}`);
		}
		log(`wrote ${configPath}`);
	}

	const registered = collectRegistered(config.graphs, usable);
	log(`registered ${registered.length} plugin graph(s), skipped ${skipped}`);
	return { registered, skipped, configPath };
}

export interface CliOptions {
	configDir?: string;
	agentDir?: string;
	workspaceGlobalDir?: string;
	systemDir?: string;
	dryRun?: boolean;
	quiet?: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
	const opts: CliOptions = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const takeValue = (): string => {
			const value = argv[++i];
			if (value === undefined) throw new Error(`missing value for ${arg}`);
			return value;
		};
		switch (arg) {
			case "--config-dir":
				opts.configDir = takeValue();
				break;
			case "--agent-dir":
				opts.agentDir = takeValue();
				break;
			case "--workspace-global-dir":
				opts.workspaceGlobalDir = takeValue();
				break;
			case "--system-dir":
				opts.systemDir = takeValue();
				break;
			case "--dry-run":
				opts.dryRun = true;
				break;
			case "--quiet":
				opts.quiet = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	return opts;
}

/**
 * Resolve CLI flags + env + defaults into `linkPluginGraphs` options.
 *
 * Defaults: `localDir` ← `--config-dir` ?? `PUNA_CONFIG_DIR` ??
 * `<agentDir>/../.puna`; `workspaceGlobalDir` ← `--workspace-global-dir` ??
 * `PUNA_WORKSPACE_GLOBAL_DIR` ?? `<localDir>/config.json`'s `globalConfigDir`
 * ?? none; `systemDir` ← `--system-dir` ?? `PUNA_SYSTEM_PLUGIN_DIR` ??
 * `~/.config/puna`.
 */
export async function resolveCliOptions(
	argv: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Promise<LinkPluginGraphsOptions & { agentDir: string }> {
	const args = parseArgs(argv);
	const agentDir = resolve(args.agentDir ?? resolve(__dirname, ".."));
	const configDir = expandTilde(
		args.configDir ?? env.PUNA_CONFIG_DIR ?? resolve(agentDir, "../.puna"),
	);
	const workspaceGlobalDir =
		args.workspaceGlobalDir ??
		env.PUNA_WORKSPACE_GLOBAL_DIR ??
		(await readGlobalConfigDir(configDir));
	const systemDir = expandTilde(
		args.systemDir ?? env.PUNA_SYSTEM_PLUGIN_DIR ?? join(homedir(), ".config", "puna"),
	);
	return {
		agentDir,
		configDir,
		workspaceGlobalDir: workspaceGlobalDir ? expandTilde(workspaceGlobalDir) : null,
		systemDir,
		dryRun: args.dryRun === true,
		quiet: args.quiet === true,
	};
}

async function main(): Promise<void> {
	const opts = await resolveCliOptions(process.argv.slice(2));
	await linkPluginGraphs(opts);
}

// Importing this module must not execute the CLI (tests import the functions).
if (typeof require !== "undefined" && require.main === module) {
	void main().catch((e) => {
		console.error(`${PREFIX} failed: ${errorMessage(e)}`);
		process.exitCode = 1;
	});
}
