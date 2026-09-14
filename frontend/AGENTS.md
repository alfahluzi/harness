# Frontend Rules

## API Client Is Auto-Generated

The frontend API client under `src/lib/api/` is **auto-generated** by
[`@hey-api/openapi-ts`](https://heyapi.vercel.app/). Never edit the generated
files by hand — they get overwritten on every regeneration.

**Pipeline:**

1. Backend serves the OpenAPI spec at `/doc`.
2. `bun run openapi:dump` (in `backend/`) writes it to `backend/openapi.json`.
3. `npm run openapi-ts` (in `frontend/`) regenerates `src/lib/api/` from that spec.

**Regenerate after any backend route/schema change:**

```bash
cd backend  && bun run openapi:dump   # refresh backend/openapi.json
cd frontend && npm run openapi-ts     # regenerate src/lib/api/
```

**Gotchas:**

- The backend normalizes path params to OpenAPI curly syntax (`{id}`) when
  serving `/doc` (see `backend/src/server.ts` — `toCurlyPathParams`). This
  works around an upstream `@hono/zod-openapi` bug where mounted sub-apps keep
  colon-style paths. Do not "fix" that normalization away, or the frontend
  client breaks again (path params stop interpolating → literal `:id` in URLs
  → 404).
- Regeneration may rename SDK functions (e.g. `getApiProvidersId` →
  `getApiProvidersById`). After regen, update hand-written callers in
  `src/hooks/` to the new names.
- Generated files are gitignored/untracked. Commit only the regenerated output
  plus any caller updates.
- `openapi-ts` **wipes** the `src/lib/api/` output directory on every run
  (default `clean: true`). Never put hand-written files there — they will be
  silently deleted. Hand-written helpers that talk to backend endpoints (e.g.
  SSE streaming) live in `src/lib/` instead (see `src/lib/stream.ts`).

## Plugin Slots

`@puna/sdk-frontend` exposes `<PluginHostProvider>` + `<PluginSlot>` + hook suite
(`usePluginRegistry`, `usePluginLeftBarItems`, `usePluginFooterBarItems`).

The provider boots by calling `GET /api/plugins?configDir=<active>` then a parallel
batch of `GET /api/plugins/{id}?configDir=<active>` to fetch each manifest's
`capabilities`. UI modules are loaded via a `loaders: Map` keyed by
`<pluginId>::<capabilityKey>::<exportName>` — supplied by the consumer (frontend
uses a static `import.meta`-style map for now; Fase 3+ switches to remote bundles).

Slot regions today: `leftBar` (single panel, slides out from dock),
`footerBar.{left,middle,right}`. New slot regions need a layout edit + a typed
hook in `@puna/sdk-frontend/host`.

Throw from a slot component → caught by the per-slot error boundary, logged to
console, renders null. App must not crash. Add `data-plugin-id="<id>"`
attributes to slot wrappers for e2e selectors.

**Wiring notes:**

- `src/lib/plugins/loader.ts` maps plugin ids to bundled UI modules. Sample
  plugin sources live under `templates/plugin/` (outside `frontend/`), so
  `tsconfig.json` `paths` + `vite.config.ts` `resolve.alias` pin `react` /
  `react-dom` to frontend's copies. Keep both in sync when moving templates.
- `src/index.css` declares `@source "../../packages/sdk-frontend/src"` and
  `@source "../../templates/plugin"` so Tailwind scans plugin sources outside
  the frontend root.
- `PluginSummary` / `PluginCapabilities` / `PluginManifest` are re-exported from
  `@puna/sdk-frontend` — import types from there, not directly from
  `@puna/sdk-shared`, to keep consumers on one SDK surface.