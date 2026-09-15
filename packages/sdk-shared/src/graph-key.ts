/**
 * Custom-graph naming policy (Fase 5 plan → Fase 6, task F6-T4).
 *
 * The host owns the namespace: plugin authors write a bare graph `id` (plus an
 * optional `alias`), and the registration key becomes
 * `` `${namespace ?? pluginId}.${alias ?? id}` ``.
 *
 * Deliberately import-free (structural input type, no zod) so the agent-side
 * dev script (`agent/scripts/link-plugin-graphs.ts`, run by tsx) and the
 * backend `PluginHost` share one policy without dragging the manifest schema
 * into the agent process.
 */

/** Minimal graph shape needed to derive a registration key. */
export interface GraphNamingInput {
	/** Bare graph id from the manifest (`kebab-case`). */
	id: string;
	/** Optional override for the un-namespaced name. */
	alias?: string;
	/** Optional explicit namespace; defaults to the plugin id. */
	namespace?: string;
}

export interface ResolvedGraphKey {
	pluginId: string;
	/** Manifest graph id, unmodified. */
	id: string;
	/** `alias ?? id` — the un-namespaced graph name. */
	name: string;
	/** `namespace ?? pluginId`. */
	namespace: string;
	/** `${namespace}.${name}` — full registration key. */
	key: string;
}

/** Derive the namespaced registration key parts for one plugin graph. */
export function resolveGraphKey(
	pluginId: string,
	graph: GraphNamingInput,
): ResolvedGraphKey {
	const name = graph.alias ?? graph.id;
	const namespace = graph.namespace ?? pluginId;
	return { pluginId, id: graph.id, name, namespace, key: `${namespace}.${name}` };
}

/** Convenience: just the namespaced key (`<pluginId>.<name>` by default). */
export function graphKey(pluginId: string, graph: GraphNamingInput): string {
	return resolveGraphKey(pluginId, graph).key;
}
