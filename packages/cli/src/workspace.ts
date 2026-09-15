/**
 * Workspace + template + manifest helpers shared by the `puna plugin` commands.
 *
 * A "workspace root" is a directory containing `.puna/` (the directory the
 * backend receives as `configDir` is `<root>/.puna`). Plugins live in
 * `<root>/.puna/plugins/<name>/`.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityEntry, PluginManifest } from "@puna/sdk-shared";
import { PluginManifest as PluginManifestSchema } from "@puna/sdk-shared";
import { CommandError, UsageError } from "./errors";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Shipped archetypes — keep in sync with `templates/plugin/`. */
export const ARCHETYPES = [
	"sticky-notes",
	"mermaid-renderer",
	"logging-hook",
	"research-agent",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** UI capability lookup order — mirrors `backend/src/modules/plugins/route.ts`. */
export const UI_CAPABILITY_ORDER = ["chatRenderers", "toolUi", "leftBar", "footerBar"] as const;
export type UiCapabilityKey = (typeof UI_CAPABILITY_ORDER)[number];

export function isArchetype(value: string): value is Archetype {
	return (ARCHETYPES as readonly string[]).includes(value);
}

export function assertArchetype(value: string): Archetype {
	if (!isArchetype(value)) {
		throw new UsageError(
			`unknown archetype "${value}": expected one of ${ARCHETYPES.join(", ")}`,
		);
	}
	return value;
}

/**
 * Resolve the workspace root.
 *
 * - `--dir <dir>`: honored as-is; a directory named `.puna` resolves to its
 *   parent, and a directory that already contains `.puna/` is used directly.
 * - no `--dir`: walk up from cwd to the first ancestor containing
 *   `.puna/config.json`; fall back to cwd (which is then initialized lazily).
 */
export function resolveWorkspaceRoot(dirFlag?: string): string {
	if (dirFlag !== undefined) {
		const abs = resolve(dirFlag);
		if (!existsSync(abs)) {
			throw new CommandError(`--dir does not exist: ${abs}`);
		}
		if (basename(abs) === ".puna") return dirname(abs);
		return abs;
	}

	let current = resolve(process.cwd());
	for (;;) {
		if (existsSync(join(current, ".puna", "config.json"))) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return resolve(process.cwd());
}

export function configDirOf(root: string): string {
	return join(root, ".puna");
}

export function pluginsDirOf(root: string): string {
	return join(configDirOf(root), "plugins");
}

/** Template root: env override → repo checkout → cwd-relative (npm layouts). */
export function templatesDir(): string {
	const candidates = [
		process.env.PUNA_PLUGIN_TEMPLATES_DIR,
		// packages/cli/src → repo root
		resolve(SRC_DIR, "..", "..", "..", "templates", "plugin"),
		// packages/cli/dist (future build output) → repo root
		resolve(SRC_DIR, "..", "..", "..", "..", "templates", "plugin"),
		resolve(process.cwd(), "templates", "plugin"),
	].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new CommandError(
		`plugin templates not found (looked in: ${candidates.join(", ")}). ` +
			`Set PUNA_PLUGIN_TEMPLATES_DIR to override.`,
	);
}

export function templateDirFor(archetype: Archetype): string {
	const dir = join(templatesDir(), archetype);
	if (!existsSync(dir)) {
		throw new CommandError(`template directory missing: ${dir}`);
	}
	return dir;
}

export interface IssuesLike {
	issues: Array<{ path: PropertyKey[]; message: string }>;
}

export function formatManifestIssues(error: IssuesLike): string {
	return error.issues
		.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
		.join("; ");
}

export interface LoadedManifest {
	/** Parsed-but-untyped JSON, used for surgical rewrites. */
	raw: Record<string, unknown>;
	manifest: PluginManifest;
	path: string;
}

/**
 * Read + strict-validate `<pluginDir>/plugin.json` against `PluginManifest`.
 * Throws `CommandError` (exit 1) on missing/invalid files — callers decide
 * whether that is fatal (`build`) or recoverable (`dev`).
 */
export async function readManifest(pluginDir: string): Promise<LoadedManifest> {
	const path = join(pluginDir, "plugin.json");
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw new CommandError(`plugin.json not found in ${pluginDir}`);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		throw new CommandError(
			`plugin.json is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new CommandError(`plugin.json must be a JSON object: ${path}`);
	}

	const parsed = PluginManifestSchema.safeParse(raw);
	if (!parsed.success) {
		throw new CommandError(`invalid plugin.json (${path}): ${formatManifestIssues(parsed.error)}`);
	}
	return { raw: raw as Record<string, unknown>, manifest: parsed.data, path };
}

export async function writeManifest(loaded: LoadedManifest): Promise<void> {
	await writeFile(loaded.path, `${JSON.stringify(loaded.raw, null, 2)}\n`, "utf8");
}

/** Declared UI capabilities in backend resolution order. */
export function uiCapabilitiesOf(
	manifest: PluginManifest,
): Array<{ key: UiCapabilityKey; cap: CapabilityEntry }> {
	const capabilities = manifest.capabilities;
	if (!capabilities) return [];
	const found: Array<{ key: UiCapabilityKey; cap: CapabilityEntry }> = [];
	for (const key of UI_CAPABILITY_ORDER) {
		const cap = capabilities[key];
		if (cap) found.push({ key, cap });
	}
	return found;
}

/** Recursively copy a template tree, skipping `node_modules`. */
export async function copyTree(srcDir: string, destDir: string): Promise<void> {
	await mkdir(destDir, { recursive: true });
	const entries = await readdir(srcDir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === "node_modules") continue;
		const src = join(srcDir, entry.name);
		const dest = join(destDir, entry.name);
		if (entry.isDirectory()) {
			await copyTree(src, dest);
		} else if (entry.isFile()) {
			await copyFile(src, dest);
		} else if (entry.isSymbolicLink()) {
			throw new CommandError(
				`template contains a symlink (${src}); templates must be plain files`,
			);
		}
	}
}
