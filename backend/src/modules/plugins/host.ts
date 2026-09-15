/**
 * Plugin host — module-level singleton consumed by the backend boot path.
 *
 * Fase 4 (this file) turns the Fase 1 stub into an execution host:
 * `discoverAndLoad` imports backend modules via `loader.ts`, then exposes
 * prompt transformers, extra agents, agent-conf overlays, tools, and the
 * permission enforcement integration point.
 *
 * Fase 5 adds node lifecycle hooks: `getLifecycleHooks()` (read-side) and
 * `runNodeHook()` (executes `beforeNode`/`afterNode` with a per-hook timeout,
 * merging `afterNode` patches with spread semantics). `getPluginHostForWorkspace`
 * caches one host per configDir for the HTTP hook routes.
 *
 * Fase 6 adds custom LangGraph descriptors: `getGraphs()` resolves each
 * manifest `capabilities.graphs` entry to a host-owned namespaced key
 * (`<namespace>.<alias ?? id>`) via `resolveGraphKey` from `@puna/sdk-shared`;
 * authors never write the prefix. Graphs need no backend module.
 *
 * Module isolation note: merging `extraAgents` / `overrideAgentConf` into
 * `AgentService` is intentionally NOT done here — `AgentService` lives in a
 * sibling module and cross-module imports are forbidden (backend/AGENTS.md).
 * `getExtraAgents()` / `applyAgentConfOverrides()` expose the data; the wiring
 * belongs to the `agents` module (or a future `global/` bridge).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginKind, PluginManifest, PluginSummary } from "@puna/sdk-shared";
import { resolveGraphKey } from "@puna/sdk-shared";
import type {
	AgentConf,
	AgentSummary,
	BackendPlugin,
	LifecycleHookDescriptor,
	LoadedPlugin,
	NodeHookRunResult,
	NodeLifecyclePhase,
	PluginGraphDescriptor,
	PromptContext,
	StructuredTool,
	ToolsConfig,
} from "./contract";
import { loadBackendModule } from "./loader";
import {
	PermissionDeniedError,
	PermissionEnforcer,
	type PermissionAction,
} from "./permissions";
import { PluginService } from "./service";

export interface DiscoverAndLoadResult {
	/** Backend modules imported successfully (`instance !== null`). */
	loaded: number;
	/** Plugins whose backend module import/instantiation failed. */
	errors: number;
}

/** A tool contributed by a plugin, re-namespaced as `${pluginId}.${name}`. */
export interface NamespacedTool extends StructuredTool {
	pluginId: string;
	originalName: string;
	/**
	 * Opt-in permission probe injected by `PluginHost.enforceTools()`.
	 * `PluginHost.getTools()` does not attach it (v1 trusted-plugin policy).
	 */
	verify?: (action: PermissionAction, target: string) => void;
}

export type PluginModuleLoader = (
	resolvedDir: string,
	manifest: PluginManifest,
) => Promise<BackendPlugin | null>;

export type SystemPromptTransformer = (
	ctx: PromptContext,
	prompt: string,
) => string | Promise<string>;

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Reject `promise` with a timeout error when it settles after `timeoutMs`.
 * The timer is always cleared on settle; the underlying promise is abandoned
 * (not awaited again) once the race is lost.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`hook timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

export class PluginHost {
	private summaries = new Map<string, PluginSummary>();
	private loaded = new Map<string, LoadedPlugin>();

	constructor(
		private readonly service: PluginService = new PluginService(),
		private readonly loader: PluginModuleLoader = loadBackendModule,
	) {}

	/**
	 * Discover plugins for `configDir` (3-layer scan via `PluginService`) and
	 * import each backend module. Replaces the internal snapshot.
	 *
	 * `loaded` counts successfully imported backend instances; `errors` counts
	 * plugins whose `loadBackendModule` threw (stored as `loadError`, with
	 * `instance: null`). Plugins without backend-side capabilities are kept in
	 * the snapshot (for `list`/`get`) but counted in neither field.
	 *
	 * Load-timing instrumentation (Fase 10 task 4): logs one
	 * `[plugins] loaded <id> in <X.Y>ms` line per discovered plugin and a
	 * `[plugins] discoverAndLoad <workspaceId>: N plugins in <X.Y>ms`
	 * total with the ≤100ms p95 budget called out. Logs are additive — loading
	 * semantics, error handling, and the returned snapshot shape are unchanged.
	 * `getPluginHostForWorkspace` caches hosts per configDir, so this runs (and
	 * logs) once per real load; `scripts/bench-plugin-load.ts` constructs fresh
	 * `PluginHost` instances to force real loads per iteration.
	 */
	async discoverAndLoad(configDir: string): Promise<DiscoverAndLoadResult> {
		const loadStartedAt = performance.now();
		const { plugins, workspaceId } = await this.service.list(configDir);

		const nextSummaries = new Map<string, PluginSummary>();
		const nextLoaded = new Map<string, LoadedPlugin>();
		let loadedCount = 0;
		let errorCount = 0;

		for (const summary of plugins) {
			const pluginStartedAt = performance.now();
			try {
				let detail: Awaited<ReturnType<PluginService["get"]>>;
				try {
					detail = await this.service.get(configDir, summary.id);
				} catch (error) {
					// Degraded summary from `list` — keep it visible, no backend module.
					console.warn(
						`[plugins] ${summary.id}: manifest detail unavailable: ${messageOf(error)}`,
					);
					nextSummaries.set(summary.id, summary);
					continue;
				}

				const { manifest, source, resolvedDir } = detail;
				nextSummaries.set(manifest.id, {
					id: manifest.id,
					name: manifest.name,
					version: manifest.version,
					description: manifest.description,
					source,
					resolvedDir,
					kind: this.kindFromManifest(manifest),
				});

				const hasBackend = Boolean(
					manifest.capabilities?.backendHooks || manifest.capabilities?.tools,
				);
				if (!hasBackend) {
					nextLoaded.set(manifest.id, {
						id: manifest.id,
						manifest,
						source,
						resolvedDir,
						instance: null,
					});
					continue;
				}

				try {
					const instance = await this.loader(resolvedDir, manifest);
					nextLoaded.set(manifest.id, {
						id: manifest.id,
						manifest,
						source,
						resolvedDir,
						instance,
					});
					if (instance) loadedCount += 1;
				} catch (error) {
					console.warn(`[plugins] ${manifest.id}: load failed: ${messageOf(error)}`);
					errorCount += 1;
					nextLoaded.set(manifest.id, {
						id: manifest.id,
						manifest,
						source,
						resolvedDir,
						instance: null,
						loadError: error instanceof Error ? error : new Error(messageOf(error)),
					});
				}
			} finally {
				const pluginMs = performance.now() - pluginStartedAt;
				console.log(`[plugins] loaded ${summary.id} in ${pluginMs.toFixed(1)}ms`);
			}
		}

		this.summaries = nextSummaries;
		this.loaded = nextLoaded;

		const totalMs = performance.now() - loadStartedAt;
		console.log(
			`[plugins] discoverAndLoad ${workspaceId}: ${plugins.length} plugins in ${totalMs.toFixed(1)}ms (p95 budget 100ms)`,
		);

		return { loaded: loadedCount, errors: errorCount };
	}

	/**
	 * Fase 1 back-compat: replace the summary snapshot without loading modules.
	 * New code uses `discoverAndLoad`.
	 */
	setLoaded(summaries: PluginSummary[]): void {
		const next = new Map<string, PluginSummary>();
		for (const summary of [...summaries].sort((a, b) => a.id.localeCompare(b.id))) {
			if (!next.has(summary.id)) next.set(summary.id, summary);
		}
		this.summaries = next;
	}

	list(): PluginSummary[] {
		return [...this.summaries.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	get(id: string): PluginSummary | undefined {
		return this.summaries.get(id);
	}

	/** Inspection helper: full loaded snapshot entry (instance + error). */
	getLoaded(id: string): LoadedPlugin | undefined {
		return this.loaded.get(id);
	}

	/** All `transformSystemPrompt` hooks, in plugin-id order (strategy §5.2). */
	getSystemPromptTransformers(): SystemPromptTransformer[] {
		const transformers: SystemPromptTransformer[] = [];
		for (const plugin of this.sortedPlugins()) {
			const transform = plugin.instance?.transformSystemPrompt;
			if (transform) transformers.push(transform);
		}
		return transformers;
	}

	/**
	 * Run transformers in plugin-id order. A throwing transformer is logged and
	 * skipped; the pipeline continues with the prompt as of that step.
	 */
	async applySystemPromptTransforms(ctx: PromptContext, prompt: string): Promise<string> {
		let current = prompt;
		for (const plugin of this.sortedPlugins()) {
			const transform = plugin.instance?.transformSystemPrompt;
			if (!transform) continue;
			try {
				current = await transform(ctx, current);
			} catch (error) {
				console.warn(
					`[plugins] ${plugin.id}: transformSystemPrompt failed: ${messageOf(error)}`,
				);
			}
		}
		return current;
	}

	/**
	 * Collect `extraAgents()` from every loaded plugin, in plugin-id order.
	 * Per-plugin failures are logged and skipped.
	 */
	async getExtraAgents(): Promise<AgentSummary[]> {
		const agents: AgentSummary[] = [];
		for (const plugin of this.sortedPlugins()) {
			const extraAgents = plugin.instance?.extraAgents;
			if (!extraAgents) continue;
			try {
				agents.push(...(await extraAgents()));
			} catch (error) {
				console.warn(`[plugins] ${plugin.id}: extraAgents failed: ${messageOf(error)}`);
			}
		}
		return agents;
	}

	/**
	 * Pipe `conf` through each plugin's `overrideAgentConf`, in plugin-id order.
	 * A throwing override is logged and the current value is kept.
	 */
	applyAgentConfOverrides(agentName: string, conf: AgentConf): AgentConf {
		let current = conf;
		for (const plugin of this.sortedPlugins()) {
			const override = plugin.instance?.overrideAgentConf;
			if (!override) continue;
			try {
				current = override(agentName, current);
			} catch (error) {
				console.warn(`[plugins] ${plugin.id}: overrideAgentConf failed: ${messageOf(error)}`);
			}
		}
		return current;
	}

	/**
	 * Aggregate plugin tools, namespaced as `${pluginId}.${toolName}` per
	 * strategy §12 Q4 (host is the single source of namespace truth). A plugin
	 * whose `tools()` factory throws is logged and skipped.
	 */
	getTools(): NamespacedTool[] {
		const tools: NamespacedTool[] = [];
		for (const plugin of this.sortedPlugins()) {
			const factory = plugin.instance?.tools;
			if (!factory) continue;
			const config: ToolsConfig = {
				configDir: plugin.resolvedDir,
				workspaceId: plugin.id,
			};
			let contributed: StructuredTool[];
			try {
				contributed = factory(config);
			} catch (error) {
				console.warn(`[plugins] ${plugin.id}: tools factory failed: ${messageOf(error)}`);
				continue;
			}
			if (!Array.isArray(contributed)) {
				console.warn(`[plugins] ${plugin.id}: tools factory did not return an array`);
				continue;
			}
			for (const tool of contributed) {
				if (!tool || typeof tool.name !== "string" || typeof tool.invoke !== "function") {
					console.warn(`[plugins] ${plugin.id}: skipping malformed tool contribution`);
					continue;
				}
				tools.push({
					...tool,
					name: `${plugin.id}.${tool.name}`,
					pluginId: plugin.id,
					originalName: tool.name,
					// Thin invocation proxy: keeps identity/args transparent and
					// leaves room for future RPC dispatch (strategy §5.4.1).
					invoke: (input: unknown) => tool.invoke(input),
				});
			}
		}
		return tools;
	}

	/**
	 * Serialize tool *descriptors* (name + description + schema, NO
	 * implementation) to `<workspaceDir>/.runtime/plugin-tools.json` for the
	 * agent sub-process (strategy §5.4.1). Creates `.runtime/` when missing.
	 *
	 * @returns absolute path of the written descriptor file.
	 */
	async writeToolDescriptors(workspaceDir: string): Promise<string> {
		const runtimeDir = join(workspaceDir, ".runtime");
		await mkdir(runtimeDir, { recursive: true });
		const path = join(runtimeDir, "plugin-tools.json");
		const tools = this.getTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			schema: tool.schema,
		}));
		await writeFile(path, `${JSON.stringify({ tools }, null, 2)}\n`, "utf8");
		return path;
	}

	/**
	 * Permission policy (strategy §8): v1 plugins are user-installed and
	 * therefore trusted — `getTools()` applies NO enforcement. This method is
	 * the explicit opt-in integration point: it returns the same namespaced
	 * tools with a bound `verify(action, target)` that consults the
	 * `PermissionEnforcer` for the contributing plugin.
	 *
	 * @throws PermissionDeniedError via `verify` when the manifest does not
	 *         declare the requested action/target.
	 */
	enforceTools(): NamespacedTool[] {
		return this.getTools().map((tool) => ({
			...tool,
			invoke: (input: unknown) => tool.invoke(input),
			verify: (action: PermissionAction, target: string) =>
				this.checkPermission(tool.pluginId, action, target),
		}));
	}

	/**
	 * Enforce the manifest allow-list for a loaded plugin.
	 *
	 * @throws PermissionDeniedError when the plugin is unknown or the
	 *         action/target pair is not declared in `manifest.permissions`.
	 */
	checkPermission(pluginId: string, action: PermissionAction, target: string): void {
		const plugin = this.loaded.get(pluginId);
		if (!plugin) throw new PermissionDeniedError(pluginId, action, target);
		new PermissionEnforcer(plugin.manifest).check(action, target);
	}

	/**
	 * Read-side descriptor list for `GET /api/plugins/hooks` (Fase 5): only
	 * loaded plugins that declare at least one node lifecycle hook, in
	 * plugin-id order.
	 */
	getLifecycleHooks(): LifecycleHookDescriptor[] {
		const out: LifecycleHookDescriptor[] = [];
		for (const plugin of this.sortedPlugins()) {
			const instance = plugin.instance;
			if (!instance) continue;
			const beforeNode = Boolean(instance.beforeNode);
			const afterNode = Boolean(instance.afterNode);
			if (beforeNode || afterNode) out.push({ id: plugin.id, beforeNode, afterNode });
		}
		return out;
	}

	/**
	 * Execute one node lifecycle phase across loaded plugins, in plugin-id
	 * order (Fase 5).
	 *
	 * Each hook runs wrapped in `withTimeout`; a throwing or timing-out hook is
	 * logged and counted as `dropped`. `beforeNode` results are ignored.
	 * `afterNode` results that are non-null objects are merged into the
	 * accumulating patch with spread semantics (a later plugin wins on key
	 * collision) so shared references are never mutated.
	 */
	async runNodeHook(
		phase: NodeLifecyclePhase,
		nodeName: string,
		state: unknown,
		cfg: unknown,
		timeoutMs = 5000,
	): Promise<NodeHookRunResult> {
		let patch: Record<string, unknown> | null = null;
		let invoked = 0;
		let dropped = 0;

		for (const plugin of this.sortedPlugins()) {
			const instance = plugin.instance;
			if (!instance) continue;
			const hook = phase === "beforeNode" ? instance.beforeNode : instance.afterNode;
			if (!hook) continue;

			try {
				const result = await withTimeout(
					Promise.resolve(hook(nodeName, state, cfg)),
					timeoutMs,
				);
				invoked += 1;
				if (phase === "afterNode" && result !== null && typeof result === "object") {
					patch = { ...(patch ?? {}), ...(result as Record<string, unknown>) };
				}
			} catch (error) {
				dropped += 1;
				console.warn(`[plugins] ${plugin.id}: ${phase} hook failed: ${messageOf(error)}`);
			}
		}

		return { patch, invoked, dropped };
	}

	/**
	 * Read-side descriptors for plugin-contributed custom graphs (Fase 6).
	 *
	 * The host owns the namespace: authors write the bare manifest graph `id`
	 * (plus optional `alias`/`namespace`) and never the prefix; the registration
	 * key is resolved as `<namespace ?? pluginId>.<alias ?? id>` by
	 * `resolveGraphKey`. Graphs do not require a backend module, so plugins
	 * with `instance === null` still contribute.
	 *
	 * Sorted deterministically by plugin id, then key.
	 */
	getGraphs(): PluginGraphDescriptor[] {
		const descriptors: PluginGraphDescriptor[] = [];
		for (const plugin of this.sortedPlugins()) {
			const graphs = plugin.manifest.capabilities?.graphs;
			if (!graphs || graphs.length === 0) continue;
			for (const graph of graphs) {
				const resolved = resolveGraphKey(plugin.id, graph);
				descriptors.push({
					key: resolved.key,
					pluginId: plugin.id,
					id: graph.id,
					name: resolved.name,
					namespace: resolved.namespace,
					entry: join(plugin.resolvedDir, graph.entry),
					export: graph.export,
				});
			}
		}
		return descriptors.sort(
			(a, b) => a.pluginId.localeCompare(b.pluginId) || a.key.localeCompare(b.key),
		);
	}

	private sortedPlugins(): LoadedPlugin[] {
		return [...this.loaded.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	/** Mirrors `PluginService.deriveKind` (private there) for snapshot summaries. */
	private kindFromManifest(manifest: PluginManifest): PluginKind {
		const caps = manifest.capabilities;
		if (!caps) return "ui";
		const hasUi = Boolean(caps.leftBar || caps.footerBar || caps.chatRenderers || caps.toolUi);
		const hasGraphs = Array.isArray(caps.graphs) && caps.graphs.length > 0;
		const hasHooks = Boolean(caps.backendHooks);
		if (hasGraphs && hasUi) return "mixed";
		if (hasGraphs) return "graph";
		if (hasHooks && !hasUi) return "agent-hook";
		return "ui";
	}
}

/**
 * Per-workspace host cache (Fase 5). The HTTP hook routes resolve a host by
 * `configDir`; each workspace gets its own `PluginHost` so plugin discovery and
 * loaded instances are independent per workspace.
 */
const workspaceHosts = new Map<string, PluginHost>();

/**
 * Resolve (and lazily discover/load) the `PluginHost` for `configDir`.
 * Cached for the process lifetime; `discoverAndLoad` failures are not cached.
 */
export async function getPluginHostForWorkspace(configDir: string): Promise<PluginHost> {
	let host = workspaceHosts.get(configDir);
	if (!host) {
		host = new PluginHost();
		await host.discoverAndLoad(configDir);
		workspaceHosts.set(configDir, host);
	}
	return host;
}

/**
 * Module-level singleton. The same instance is shared by `server.ts` boot and
 * the plugin routes (which use it as a read-side cache after `setLoaded`).
 */
export const pluginHost = new PluginHost();
