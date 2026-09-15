/**
 * Backend plugin contract — types only (Fase 4/5).
 *
 * Mirrors strategy §5.3. Plugins default-export a `BackendPlugin` object (or a
 * factory returning one); `loader.ts` resolves it and `host.ts` executes the
 * hooks. No runtime code belongs in this file.
 */
import type { PluginManifest, PluginSource } from "@puna/sdk-shared";

export interface PromptContext {
	agentName: string;
	workspaceId: string;
	configDir: string;
}

export interface AgentSummary {
	name: string;
	description?: string | null;
	source?: string;
}

export interface AgentConf {
	name?: string;
	role?: string;
	temperature?: number;
	called?: string;
	description?: string;
	providerId?: string;
	modelId?: string;
	tools?: { allow?: string[]; deny?: string[] };
}

export interface ToolsConfig {
	configDir: string;
	workspaceId: string;
}

export interface StructuredTool {
	name: string;
	description?: string;
	schema?: unknown;
	invoke: (input: unknown) => Promise<unknown> | unknown;
}

export interface BackendPlugin {
	id: string;
	transformSystemPrompt?: (ctx: PromptContext, prompt: string) => string | Promise<string>;
	beforeNode?: (nodeName: string, state: unknown, cfg: unknown) => Promise<void>;
	afterNode?: (
		nodeName: string,
		state: unknown,
		cfg: unknown,
	) => Promise<Record<string, unknown> | void>;
	extraAgents?: () => Promise<AgentSummary[]>;
	overrideAgentConf?: (agentName: string, conf: AgentConf) => AgentConf;
	tools?: (config: ToolsConfig) => StructuredTool[];
}

/** Node lifecycle hook phases executed over HTTP (Fase 5). */
export type NodeLifecyclePhase = "beforeNode" | "afterNode";

/** Read-side descriptor for `GET /api/plugins/hooks` (Fase 5). */
export interface LifecycleHookDescriptor {
	id: string;
	beforeNode: boolean;
	afterNode: boolean;
}

/** Aggregated outcome of one `POST /api/plugins/hooks` run (Fase 5). */
export interface NodeHookRunResult {
	/** Merged `afterNode` patches; `null` when nothing was merged. */
	patch: Record<string, unknown> | null;
	/** Hooks that completed within the timeout. */
	invoked: number;
	/** Hooks that threw or timed out. */
	dropped: number;
}

/** One plugin-contributed custom LangGraph (Fase 6). */
export interface PluginGraphDescriptor {
	/** Host-owned namespaced key: `<namespace>.<name>`. */
	key: string;
	pluginId: string;
	/** Manifest graph id, unmodified. */
	id: string;
	/** `alias ?? id`. */
	name: string;
	/** `namespace ?? pluginId`. */
	namespace: string;
	/** Absolute path to the graph module entry (`<resolvedDir>/<graph.entry>`). */
	entry: string;
	/** Named export in the entry module (manifest default `"graph"`). */
	export: string;
}

export interface LoadedPlugin {
	id: string;
	manifest: PluginManifest;
	source: PluginSource;
	resolvedDir: string;
	instance: BackendPlugin | null;
	loadError?: Error;
}
