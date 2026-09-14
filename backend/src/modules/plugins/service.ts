import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadWorkspaceContext } from "../../global/workspace-context";
import {
	mergeLayered3,
	defaultSystemPluginDir,
	type ThreeLayeredEntry,
	type ThreeLayerSource,
} from "../../global/workspace-scanner";
import { PluginManifest, PluginSummary, PluginKind } from "@puna/sdk-shared";

export class PluginNotFoundError extends Error {
	constructor(id: string) {
		super(`Plugin not found: ${id}`);
	}
}

export class PluginManifestError extends Error {
	constructor(id: string, cause: unknown) {
		super(
			`Invalid manifest for ${id}: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
}

/** Detail payload for `GET /plugins/:id`. */
export interface PluginDetailResponse {
	manifest: PluginManifest;
	source: ThreeLayerSource;
	resolvedDir: string;
}

const MARKER = "plugin.json";

export class PluginService {
	/**
	 * List all plugins across 3 layers (workspace-local, workspace-global,
	 * system-global). Local wins on directory-name collision.
	 *
	 * @param configDir — workspace's `<root>/.puna/` directory
	 */
	async list(configDir: string): Promise<{
		workspaceId: string;
		globalConfigDir: string | null;
		plugins: PluginSummary[];
	}> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const localDir = join(configDir, "plugins");
		const workspaceGlobalDir = ctx.globalConfigDir ? join(ctx.globalConfigDir, "plugins") : null;
		const systemDir = join(defaultSystemPluginDir(), "plugins");

		const entries = await mergeLayered3(localDir, workspaceGlobalDir, systemDir, MARKER);
		const plugins = await Promise.all(entries.map((e) => this.toSummary(e)));
		return { workspaceId: ctx.id, globalConfigDir: ctx.globalConfigDir, plugins };
	}

	/**
	 * Get full manifest for one plugin.
	 *
	 * Identity comes from the manifest `id` field, NOT the directory name —
	 * the same plugin may live in a differently-named directory per layer.
	 * Iterates all 3 layers and returns the first manifest whose `id` matches.
	 *
	 * @param configDir — workspace's `<root>/.puna/` directory
	 * @param id — plugin `id` from `plugin.json`
	 */
	async get(configDir: string, id: string): Promise<PluginDetailResponse> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const localDir = join(configDir, "plugins");
		const workspaceGlobalDir = ctx.globalConfigDir ? join(ctx.globalConfigDir, "plugins") : null;
		const systemDir = join(defaultSystemPluginDir(), "plugins");

		const entries = await mergeLayered3(localDir, workspaceGlobalDir, systemDir, MARKER);
		for (const entry of entries) {
			let manifest: PluginManifest;
			try {
				manifest = await this.readManifest(entry);
			} catch (e) {
				console.warn(`[plugins] skipping ${entry.dir}: ${(e as Error).message}`);
				continue;
			}
			if (manifest.id === id) {
				return { manifest, source: entry.source, resolvedDir: entry.dir };
			}
		}
		throw new PluginNotFoundError(id);
	}

	/**
	 * Best-effort summary for list. Bad manifests degrade to a minimal summary
	 * instead of failing the whole listing (Fase 1 list is best-effort).
	 */
	private async toSummary(entry: ThreeLayeredEntry): Promise<PluginSummary> {
		try {
			const manifest = await this.readManifest(entry);
			return {
				id: manifest.id,
				name: manifest.name,
				version: manifest.version,
				description: manifest.description,
				source: entry.source,
				resolvedDir: entry.dir,
				kind: this.deriveKind(manifest),
			};
		} catch (e) {
			console.warn(`[plugins] invalid manifest at ${entry.dir}: ${(e as Error).message}`);
			return {
				id: entry.name,
				name: entry.name,
				version: "0.0.0",
				source: entry.source,
				resolvedDir: entry.dir,
				kind: "ui",
			};
		}
	}

	/** Read + strict-parse `<dir>/plugin.json`. Throws `PluginManifestError`. */
	private async readManifest(entry: ThreeLayeredEntry): Promise<PluginManifest> {
		const path = join(entry.dir, MARKER);
		if (!existsSync(path)) {
			throw new PluginManifestError(entry.name, `${MARKER} missing`);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(await readFile(path, "utf8"));
		} catch (e) {
			throw new PluginManifestError(entry.name, e);
		}
		const parsed = PluginManifest.safeParse(raw);
		if (!parsed.success) {
			throw new PluginManifestError(entry.name, parsed.error.issues[0]?.message ?? parsed.error.message);
		}
		return parsed.data;
	}

	/**
	 * Derive the plugin kind from its capabilities.
	 *
	 * - graphs + any UI capability       → `mixed`
	 * - graphs only                      → `graph`
	 * - backendHooks only (no UI)        → `agent-hook`
	 * - any UI capability                → `ui`
	 * - no `capabilities` at all         → `ui` (default; most plugins are UI)
	 */
	private deriveKind(manifest: PluginManifest): PluginKind {
		const caps = manifest.capabilities;
		if (!caps) return "ui";
		const hasUi = Boolean(
			caps.leftBar || caps.footerBar || caps.chatRenderers || caps.toolUi,
		);
		const hasGraphs = Array.isArray(caps.graphs) && caps.graphs.length > 0;
		const hasHooks = Boolean(caps.backendHooks);
		if (hasGraphs && hasUi) return "mixed";
		if (hasGraphs) return "graph";
		if (hasHooks && !hasUi) return "agent-hook";
		return "ui";
	}
}
