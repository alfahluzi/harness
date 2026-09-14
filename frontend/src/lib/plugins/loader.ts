/**
 * App-specific plugin UI loader wiring.
 *
 * Fase 2 bundles plugin UI statically (sample templates live in the repo).
 * Keys follow the SDK contract: `<pluginId>::<capabilityKey>::<exportName>`.
 * Fase 3+ swaps these entries for remote bundle imports from
 * `GET /api/plugins/{id}/ui-bundle` — the `Loaders` shape stays the same.
 */
import { loaderKey, type Loaders } from "@puna/sdk-frontend";
import * as StickyNotesUi from "../../../../templates/plugin/sticky-notes/ui/index.tsx";

export const pluginLoaders: Loaders = new Map([
	[
		loaderKey("sticky-notes", "leftBar", "StickyNotesEntry"),
		async () => ({ default: StickyNotesUi.StickyNotesEntry }),
	],
	[
		loaderKey("sticky-notes", "footerBar", "StickyNotesCounter"),
		async () => ({ default: StickyNotesUi.StickyNotesCounter }),
	],
]);
