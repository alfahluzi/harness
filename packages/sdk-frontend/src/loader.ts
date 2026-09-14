/**
 * UI module loader contract.
 *
 * Loader keys are `<pluginId>::<capabilityKey>::<exportName>` where
 * `exportName` is `""` for a default export. The consumer (`frontend/`) owns
 * the map: Fase 2 uses static imports of bundled sample-plugin sources; Fase 3+
 * switches to remote `GET /api/plugins/{id}/ui-bundle` modules.
 */
import type { ComponentType } from "react";
import type { PluginCapabilityKey } from "./registry";

/** Props the host passes to every loaded plugin slot component. */
export type PluginComponentProps = {
	pluginId: string;
	configDir: string;
};

export type PluginComponentType = ComponentType<Record<string, unknown>>;

/** Module namespace returned by a loader (default + optional named exports). */
export type PluginModule = {
	default: PluginComponentType;
} & Record<string, unknown>;

export type PluginLoader = () => Promise<PluginModule>;

export type Loaders = Map<string, PluginLoader>;

/** Build a loader key consistently. `exportName` omitted/empty = default export. */
export function loaderKey(
	pluginId: string,
	capabilityKey: PluginCapabilityKey,
	exportName = "",
): string {
	return `${pluginId}::${capabilityKey}::${exportName}`;
}
