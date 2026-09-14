/**
 * @puna/sdk-frontend — PluginHostProvider, slot helpers, registry loader.
 *
 * Consumed by `frontend/src/`. Implemented across Fase 2 (slots) + Fase 3 (chat renderers).
 */
export const SDK_FRONTEND_VERSION = "0.1.0";

export * from "./registry";
export * from "./loader";
export * from "./slots";
export * from "./badge";
export * from "./host";

// Re-exported so consumers type plugin data without a second dependency import.
export {
	PluginCapabilities,
	PluginKind,
	PluginManifest,
	PluginSource,
	PluginSummary,
} from "@puna/sdk-shared";
