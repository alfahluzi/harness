import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../../global/config";
import { loadWorkspaceContext, InvalidWorkspaceError } from "../../global/workspace-context";
import { mergeLayered, type LayeredEntry } from "../../global/workspace-scanner";
import {
	InstallConf,
	type InstalledDetailResponse,
	type InstalledListResponse,
	type InstalledMcpSummary,
	type InstallResponse,
	type UninstallResponse,
} from "./schema";
import { RegistryClient, RegistryError, RegistryNotFoundError } from "./registry";

const MARKER = "conf.json";

export class McpNotFoundError extends Error {
	constructor(name: string) {
		super(`MCP not installed: ${name}`);
		this.name = "McpNotFoundError";
	}
}

export class McpAlreadyInstalledError extends Error {
	constructor(name: string) {
		super(`MCP already installed: ${name}`);
		this.name = "McpAlreadyInstalledError";
	}
}

export class McpConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpConfigError";
	}
}

/**
 * Service for managing installed MCPs in a .puna workspace.
 *
 * Install = fetch metadata from the official MCP Registry and write a
 * `.puna/mcps/<name>/conf.json` that describes how to launch the server
 * (npm identifier, transport, env-var schema). The agent runtime is
 * responsible for spawning the actual process and supplying env values.
 *
 * Uninstall = remove the conf.json directory. Any running process spawned
 * from this config must be stopped by the caller.
 */
export class McpService {
	private registry: RegistryClient;
	private systemMcpDir: string;

	constructor(opts: { registry?: RegistryClient; systemMcpDir?: string } = {}) {
		this.registry = opts.registry ?? new RegistryClient();
		this.systemMcpDir = opts.systemMcpDir ?? config.systemMcpDir;
	}

	// -------------------------------------------------------------------------
	// Installed (layered local > per-workspace global > system-wide global)
	// -------------------------------------------------------------------------

	async listInstalled(configDir: string): Promise<InstalledListResponse> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const entries = await this.collectLayers(configDir, ctx.globalConfigDir);
		const mcps = await Promise.all(entries.map((e) => this.toSummary(e)));
		return {
			workspaceId: ctx.id,
			globalConfigDir: ctx.globalConfigDir,
			mcps,
		};
	}

	async getInstalled(configDir: string, name: string): Promise<InstalledDetailResponse> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const entries = await this.collectLayers(configDir, ctx.globalConfigDir);
		const found = entries.find((e) => e.name === name);
		if (!found) throw new McpNotFoundError(name);
		const conf = await this.readConf(found.dir);
		return {
			name,
			source: found.source,
			resolvedDir: found.dir,
			conf,
		};
	}

	// -------------------------------------------------------------------------
	// Mutate: install / uninstall
	// -------------------------------------------------------------------------

	/**
	 * Install a public MCP into either the workspace's local `.puna/mcps/`
	 * (target="local", default) or the system-wide `config.systemMcpDir`
	 * (target="global"). The system-wide dir is XDG-aware and shared across
	 * all workspaces.
	 *
	 * Throws `McpAlreadyInstalledError` if the target directory already has
	 * an entry with the same name.
	 */
	async install(
		configDir: string,
		name: string,
		opts: { version?: string; target?: "local" | "global" } = {},
	): Promise<InstallResponse> {
		const target: "local" | "global" = opts.target ?? "local";
		const ctx = await loadWorkspaceContext(configDir, configDir);

		const existing = await this.collectLayers(configDir, ctx.globalConfigDir);
		if (existing.some((e) => e.name === name)) {
			throw new McpAlreadyInstalledError(name);
		}

		const installDir =
			target === "global" ? this.systemMcpDir : join(configDir, "mcps");

		let detail;
		try {
			detail = await this.registry.getLatest(name, { version: opts.version });
		} catch (e) {
			if (e instanceof RegistryError) throw e;
			throw e;
		}

		const installedAt = new Date().toISOString();
		const dir = join(installDir, this.safeName(name));
		await mkdir(dir, { recursive: true });

		const conf: InstallConf = InstallConf.parse({
			name: detail.name,
			version: detail.version,
			source: "official-registry",
			installedAt,
			title: detail.title,
			description: detail.description,
			repositoryUrl: detail.repositoryUrl,
			status: detail.status,
			packages: detail.packages,
			remotes: detail.remotes,
		});

		await writeFile(join(dir, MARKER), JSON.stringify(conf, null, 2) + "\n", "utf8");

		return {
			name: conf.name,
			installedAt: conf.installedAt,
			version: conf.version,
			target,
		};
	}

	/**
	 * Remove an installed MCP. Searches all three layers in priority order
	 * (local > per-workspace global > system-wide global) and removes from
	 * the first match.
	 */
	async uninstall(configDir: string, name: string): Promise<UninstallResponse> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const entries = await this.collectLayers(configDir, ctx.globalConfigDir);
		const found = entries.find((e) => e.name === name);
		if (!found) throw new McpNotFoundError(name);
		await rm(found.dir, { recursive: true, force: true });
		return { name, uninstalled: true };
	}

	// -------------------------------------------------------------------------
	// Internal helpers
	// -------------------------------------------------------------------------

	private async toSummary(entry: LayeredEntry): Promise<InstalledMcpSummary> {
		const conf = await this.readConf(entry.dir);
		const firstPkg = conf.packages[0];
		const envs = firstPkg?.environmentVariables ?? [];
		return {
			name: conf.name,
			source: entry.source,
			title: conf.title,
			description: conf.description,
			version: conf.version,
			registryType: firstPkg?.registryType ?? null,
			identifier: firstPkg?.identifier ?? null,
			transport: firstPkg?.transport ?? null,
			requiredEnvCount: envs.filter((e) => e.required).length,
			secretEnvCount: envs.filter((e) => e.secret).length,
			installedAt: conf.installedAt,
		};
	}

	private async readConf(dir: string): Promise<InstallConf> {
		const p = join(dir, MARKER);
		if (!existsSync(p)) {
			throw new McpConfigError(`Missing ${MARKER} in ${dir}`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(p, "utf8"));
		} catch (e) {
			throw new McpConfigError(`Failed to parse ${p}: ${(e as Error).message}`);
		}
		const result = InstallConf.safeParse(parsed);
		if (!result.success) {
			throw new McpConfigError(
				`Invalid ${MARKER} in ${dir}: ${result.error.issues[0]?.message ?? "unknown"}`,
			);
		}
		return result.data;
	}

	/**
	 * Server names are namespaced (e.g. `io.github.user/my-server`) — the
	 * slash would create a subdirectory. Sanitize to a stable filesystem-safe
	 * form so the same name always maps to the same directory.
	 */
	private safeName(name: string): string {
		return name.replace(/[\\/]/g, "__");
	}

	/**
	 * Merge three layers in priority order: local > per-workspace global >
	 * system-wide global. Lower-priority entries are dropped on name collision.
	 * System-wide entries are labeled `source: "global"` for the UI; the
	 * workspace-per-global label is also `"global"` (we don't surface that
	 * distinction in v1).
	 */
	private async collectLayers(
		configDir: string,
		globalConfigDir: string | null,
	): Promise<LayeredEntry[]> {
		const localDir = join(configDir, "mcps");
		const perWorkspaceGlobalDir = globalConfigDir ? join(globalConfigDir, "mcps") : null;
		const systemDir = this.systemMcpDir;

		const localPlusWorkspace = await mergeLayered(localDir, perWorkspaceGlobalDir, MARKER);
		const systemOnly = await mergeLayered(null, systemDir, MARKER);

		const map = new Map<string, LayeredEntry>();
		for (const e of systemOnly) map.set(e.name, e);
		for (const e of localPlusWorkspace) map.set(e.name, e);
		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
	}
}

// Re-export for callers who want to construct them explicitly.
export { RegistryClient, RegistryError, RegistryNotFoundError };