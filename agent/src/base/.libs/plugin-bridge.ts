/**
 * Plugin lifecycle bridge (HTTP).
 *
 * The agent runs as a separate LangGraph sub-process from the backend (Hono).
 * Plugin `beforeNode`/`afterNode` hooks are plain functions loaded in the
 * BACKEND process, so they cannot be serialized over HTTP. Therefore the agent
 * only sends lifecycle events to the backend RPC; the backend executes the
 * hooks and returns a state patch.
 *
 * Flow per node invocation (wrapped via `withPluginHooks`):
 *   1. GET `${backendUrl}/api/plugins/hooks?configDir=...` — descriptor discovery
 *      (cached per `${backendUrl}|${configDir}` for the process lifetime).
 *   2. If any plugin declares `beforeNode` or `afterNode`, one POST per phase.
 *
 * NOTE / deviation from strategy §5.4 pseudocode: the pseudocode assumed hook
 * functions could be invoked directly by the agent. That is impossible across
 * process boundaries, so responsibility is inverted — the backend owns hook
 * execution and the agent only reports events and applies returned patches.
 *
 * Everything here is FAIL-OPEN: hook plumbing failures never throw; they warn
 * and pass through to the node implementation.
 */

export type NodeLifecyclePhase = "beforeNode" | "afterNode";

export interface LifecycleHookDescriptor {
	id: string;
	beforeNode: boolean;
	afterNode: boolean;
}

export interface HooksListResponse {
	configDir: string;
	timeoutMs: number;
	plugins: LifecycleHookDescriptor[];
}

export interface HookRunResponse {
	patch: Record<string, unknown> | null;
	invoked: number;
	dropped: number;
}

export const DEFAULT_BACKEND_URL =
	process.env.PUNA_BACKEND_URL ?? "http://localhost:3001";

export const DEFAULT_HOOK_TIMEOUT_MS = 5000;

interface BridgeConfig {
	configDir: string | null;
	backendUrl: string;
	timeoutMs: number;
}

/** Cache keyed `${backendUrl}|${configDir}` so discovery GET happens once per run/process. */
const hooksCache = new Map<string, LifecycleHookDescriptor[]>();

/** Test hook: clears the module-level descriptor cache. */
export function resetPluginHookCache(): void {
	hooksCache.clear();
}

export function resolveBridge(config: any): BridgeConfig {
	const c = config?.configurable;
	return {
		configDir: c?.config_dir ?? c?.configDir ?? null,
		backendUrl:
			c?.backend_url ??
			c?.backendUrl ??
			process.env.PUNA_BACKEND_URL ??
			DEFAULT_BACKEND_URL,
		timeoutMs: c?.hook_timeout_ms ?? c?.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
	};
}

/**
 * Discover plugin node-lifecycle hooks from the backend.
 * Returns [] when no configDir is configured or on any failure (fail-open).
 */
export async function fetchPluginHooks(
	config: any,
): Promise<LifecycleHookDescriptor[]> {
	const bridge = resolveBridge(config);
	if (!bridge.configDir) return [];

	const cacheKey = `${bridge.backendUrl}|${bridge.configDir}`;
	const cached = hooksCache.get(cacheKey);
	if (cached) return cached;

	try {
		const url = `${bridge.backendUrl}/api/plugins/hooks?configDir=${encodeURIComponent(
			bridge.configDir,
		)}`;
		const res = await fetch(url, {
			signal: AbortSignal.timeout(bridge.timeoutMs),
		});
		if (!res.ok) {
			console.warn(
				`[plugins] hook discovery failed: HTTP ${res.status} for ${url}`,
			);
			return [];
		}
		const body = (await res.json()) as Partial<HooksListResponse> | null;
		const plugins = Array.isArray(body?.plugins) ? body!.plugins! : [];
		hooksCache.set(cacheKey, plugins);
		return plugins;
	} catch (err: any) {
		console.warn(
			`[plugins] hook discovery failed: ${err?.message ?? String(err)}`,
		);
		return [];
	}
}

/**
 * Run backend-side plugins for one node lifecycle phase.
 * Returns the state patch or null; never throws (fail-open).
 */
export async function runNodeHooks(
	phase: NodeLifecyclePhase,
	nodeName: string,
	state: Record<string, unknown>,
	config: any,
): Promise<Record<string, unknown> | null> {
	const bridge = resolveBridge(config);
	if (!bridge.configDir) return null;

	try {
		const url = `${bridge.backendUrl}/api/plugins/hooks?configDir=${encodeURIComponent(
			bridge.configDir,
		)}`;
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				phase,
				node: nodeName,
				state,
				config: config?.configurable ?? {},
			}),
			signal: AbortSignal.timeout(bridge.timeoutMs),
		});
		if (!res.ok) {
			console.warn(
				`[plugins] ${phase} hook for "${nodeName}" failed: HTTP ${res.status}`,
			);
			return null;
		}
		const body = (await res.json()) as Partial<HookRunResponse> | null;
		return body?.patch ?? null;
	} catch (err: any) {
		console.warn(
			`[plugins] ${phase} hook for "${nodeName}" failed: ${
				err?.message ?? String(err)
			}`,
		);
		return null;
	}
}

/**
 * Wrap a LangGraph node so plugin `beforeNode` / `afterNode` hooks run
 * around it via the backend RPC.
 *
 * Zero overhead when no `configDir` is configured or no plugin declares a
 * node-lifecycle hook. Only errors thrown by `fn` itself propagate.
 */
export function withPluginHooks<N extends string>(
	name: N,
	fn: (state: any, config: any) => Promise<any>,
): (state: any, config: any) => Promise<any> {
	return async (state: any, config: any) => {
		const bridge = resolveBridge(config);
		if (!bridge.configDir) return fn(state, config);

		const descriptors = await fetchPluginHooks(config);
		const relevant = descriptors.filter((p) => p.beforeNode || p.afterNode);
		if (relevant.length === 0) return fn(state, config);

		await runNodeHooks("beforeNode", name, state, config);

		const out = await fn(state, config);

		const patch = await runNodeHooks(
			"afterNode",
			name,
			{ ...state, ...out },
			config,
		);
		if (patch) return { ...out, ...patch };
		return out;
	};
}
