/**
 * App-specific plugin UI loader wiring.
 *
 * Fase 2 bundles plugin UI statically (sample templates live in the repo).
 * Keys follow the SDK contract: `<pluginId>::<capabilityKey>::<exportName>`.
 * Fase 3+ swaps these entries for remote bundle imports from
 * `GET /api/plugins/{id}/ui-bundle` — the `Loaders` shape stays the same.
 */
import {
	loaderKey,
	type Loaders,
	type PluginLoader,
	type PluginModule,
} from "@puna/sdk-frontend";
import * as MermaidRenderer from "../../../../templates/plugin/mermaid-renderer/ui/index.tsx";
import * as StickyNotesUi from "../../../../templates/plugin/sticky-notes/ui/index.tsx";

export const pluginLoaders: Loaders = new Map<string, PluginLoader>([
	[
		loaderKey("sticky-notes", "leftBar", "StickyNotesEntry"),
		async () => ({ default: StickyNotesUi.StickyNotesEntry }),
	],
	[
		loaderKey("sticky-notes", "footerBar", "StickyNotesCounter"),
		async () => ({ default: StickyNotesUi.StickyNotesCounter }),
	],
	[
		// F3-T4: object-shaped capability. The loader hands back the whole
		// module record; `usePluginToolUi` picks `module[export]` (the
		// tool-name map) instead of resolving a single default component.
		// Cast keeps this entry honest even when the module has no `default`.
		loaderKey("mermaid-renderer", "toolUi", "toolUi"),
		async () => MermaidRenderer as unknown as PluginModule,
	],
]);
