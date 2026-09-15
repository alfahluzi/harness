/**
 * @puna/sdk-agent — plugin SDK: lifecycle bridge contract types for LangGraph nodes.
 *
 * Fase 5 landed the HTTP hook contract types (descriptor discovery + hook run
 * responses). The runtime bridge that talks to the backend RPC lives in
 * `agent/src/base/.libs/plugin-bridge.ts` (agent process).
 */
export const SDK_AGENT_VERSION = '0.1.0';

export type NodeLifecyclePhase = "beforeNode" | "afterNode";

export interface LifecycleHookDescriptor {
	id: string;
	beforeNode: boolean;
	afterNode: boolean;
}

export interface HookRunResponse {
	patch: Record<string, unknown> | null;
	invoked: number;
	dropped: number;
}
