/**
 * logging-hook — Fase 5 node lifecycle hooks.
 *
 * Executed in the BACKEND process: the agent sub-process reports lifecycle
 * events over `GET`/`POST /api/plugins/hooks` and the backend invokes these
 * functions (see `agent/src/base/.libs/plugin-bridge.ts`).
 *
 * Both hooks are read-only — they log and return no state patch, so `afterNode`
 * yields `patch: null` and graph state is never modified.
 *
 * NOTE: `@puna/sdk-backend` is not installed/linked in this workspace's
 * `node_modules`, so the `BackendPlugin` shape is mirrored structurally below
 * (no runtime difference; matches backend/src/modules/plugins/contract.ts).
 */

const PREFIX = "[plugin:logging-hook]";

function summarize(state: unknown): Record<string, unknown> | undefined {
	if (!state || typeof state !== "object") return undefined;
	const messages = (state as { messages?: unknown }).messages;
	return { messageCount: Array.isArray(messages) ? messages.length : undefined };
}

/** Fase 5: log every node entry. Returns void — no state patch. */
export async function beforeNode(
	nodeName: string,
	state: unknown,
	_cfg: unknown,
): Promise<void> {
	console.log(`${PREFIX} -> before ${nodeName}`, summarize(state));
}

/** Fase 5: log every node exit. Returns void — no state patch. */
export async function afterNode(
	nodeName: string,
	state: unknown,
	_cfg: unknown,
): Promise<void> {
	console.log(`${PREFIX} <- after ${nodeName}`, summarize(state));
}

/** Structural mirror of the backend `BackendPlugin` contract (types only). */
interface BackendPlugin {
	id: string;
	beforeNode?: (
		nodeName: string,
		state: unknown,
		cfg: unknown,
	) => Promise<void>;
	afterNode?: (
		nodeName: string,
		state: unknown,
		cfg: unknown,
	) => Promise<Record<string, unknown> | void>;
}

const plugin: BackendPlugin = { id: "logging-hook", beforeNode, afterNode };
export default plugin;
