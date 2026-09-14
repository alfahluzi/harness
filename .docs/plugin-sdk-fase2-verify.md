# Fase 2 — Visual Check Stub

> Gate 9 for `.docs/plugin-sdk.implementation-plan.md` §4 Fase 2.
> Automated gates (install / typecheck / tests / openapi / manifest parse / build)
> are covered in `.docs/plugin-sdk.implementation-plan.progress.md`. This file
> documents the manual/browser checks and the wiring behind them.

---

## 1. Left dock flow — `LeftDockWithPlugins`

`frontend/src/routes/u/route.tsx`:

```tsx
function LeftDockWithPlugins() {
  const pluginItems = usePluginLeftBarItems();          // sdk-frontend
  const dockItems = useMemo(
    () => [...DOCK_ITEMS, ...pluginItems],
    [pluginItems],
  );
  return <LeftBar items={dockItems} />;
}
```

1. Module-level `DOCK_ITEMS` (static: workspace, chat, mcps, agents, skills,
   settings) renders first — core navigation order is stable.
2. `usePluginLeftBarItems()` walks `registry.plugins` (Map, list order) and emits
   one `PluginNavigationItem` per plugin declaring `capabilities.leftBar`:
   - `id: "<pluginId>:leftBar"` (e.g. `sticky-notes:leftBar`)
   - `label: summary.name`
   - `title: "<name> · <source> · <kind>"` (tooltip)
   - `icon: PluginDockIcon` (default `StickyNotesIcon` + source-colored dot)
   - `child:` panel chrome (plugin name + `PluginSourceBadge` header) wrapping
     `<PluginErrorBoundary>` → `<LoadedPluginComponent capabilityKey="leftBar">
3. `LeftBar` renders the union; clicking a plugin item activates it and
   `NavigationPanel` mounts `child` — the loader resolves lazily on first mount.

Component resolution:
`LoadedPluginComponent` builds `loaderKey("<id>", "leftBar", "<export>")`, looks
it up in the consumer `loaders` map (`frontend/src/lib/plugins/loader.ts`),
resolves the named export (falls back to `default`), and caches it in provider
state. Unwired capability → renders `null` (no crash).

## 2. Source badge title format

- Tooltip / `title` on every plugin dock button and footer item:
  `"<name> · <source> · <kind>"` — e.g. `Sticky Notes · workspace-local · ui`.
- Dock icon carries a source-colored dot overlay:
  - `workspace-local` → emerald/green
  - `workspace-global` → blue
  - `system-global` → purple
- Plugin panel header renders the full `<PluginSourceBadge source kind />`:
  `text-[10px] uppercase tracking-wide px-1 py-0.5 rounded-sm`, color-coded,
  with the kind as a muted suffix (`workspace-local · ui`).

## 3. Footer counter derives from registry length

`frontend/src/layout/footer-bar.tsx`:

```tsx
const registry = usePluginRegistry();
...
<_FooterButton title={registry.error ? ... : `${registry.plugins.size} plugin(s) loaded`}>
  <span className="mx-2">Plugins: {registry.plugins.size}</span>
</_FooterButton>
```

The static `Plugins: 2` placeholder is gone. With an active workspace and the
`sticky-notes` plugin enabled, the count reads `1`; with no config dir / empty
plugin dir it reads `0`.

## 4. Footer 3-region slots

| Region | Slot element |
|---|---|
| left | `<PluginSlot slot="footerBar.left">{footerLeft}</PluginSlot>` (start of left cluster) |
| middle | `<PluginSlot slot="footerBar.middle">{footerMiddle}</PluginSlot>` (middle cluster) |
| right | `<PluginSlot slot="footerBar.right">{footerRight}</PluginSlot>` (before token/bill) |

`PluginCapabilities.footerBar` is a single entry (no region in the strict
schema), so Fase 2 routes footer contributions to
`DEFAULT_FOOTER_REGION = "right"` — matching the old `footerBar.right` sample.
`usePluginFooterBarItems("left" | "middle")` currently returns `[]`. The
`sticky-notes` counter (`Notes: <n>`) renders in the right region.

## 5. Error boundary wrap

- `PluginErrorBoundary` (`packages/sdk-frontend/src/slots.tsx`) is a class with
  `getDerivedStateFromError` + `componentDidCatch`; on throw it
  `console.error("[puna:plugins] slot \"<id>:<capability>\" crashed", ...)` and
  renders `fallback ?? null`.
- Used per slot: leftBar panel child, each footer item, and by `<PluginSlot>`
  wrappers in `footer-bar.tsx`.
- Manual check: temporarily throw inside `StickyNotesEntry` → left dock panel
  goes blank, app shell (header/left dock/footer) keeps working, console shows
  one boundary log.

## 6. Files touched (Fase 2)

**SDK — new**
- `packages/sdk-frontend/src/registry.ts`
- `packages/sdk-frontend/src/loader.ts`
- `packages/sdk-frontend/src/slots.tsx`
- `packages/sdk-frontend/src/badge.tsx`
- `packages/sdk-frontend/src/host.tsx`
- `packages/sdk-frontend/tsconfig.json`
- `packages/sdk-shared/tsconfig.json`
- `tsconfig.json` (repo root base)
- `frontend/src/lib/plugins/loader.ts`
- `.docs/plugin-sdk-fase2-verify.md` (this file)

**SDK — modified**
- `packages/sdk-frontend/src/index.ts` (real exports)
- `packages/sdk-frontend/package.json` (devDeps)
- `packages/sdk-shared/package.json` (devDeps)

**Frontend — modified**
- `frontend/package.json` (+ `@puna/sdk-frontend`, `@puna/sdk-shared`)
- `frontend/src/main.tsx` (`AppShell` + provider mount)
- `frontend/src/routes/u/route.tsx` (`LeftDockWithPlugins`)
- `frontend/src/layout/left-bar.tsx` (`title` field)
- `frontend/src/layout/footer-bar.tsx` (3 regions + real count)
- `frontend/src/index.css` (`@source` for SDK + templates)
- `frontend/tsconfig.json` (`react` paths)
- `frontend/vite.config.ts` (`react`/`react-dom` aliases)
- `frontend/AGENTS.md` (`## Plugin Slots`, CT-1)

> `frontend/src/lib/api/**` intentionally untouched; the initial `tsc` errors
> came from a stale `node_modules/.tmp/tsconfig.tsbuildinfo` cache, cleared
> during verification (`git diff -- frontend/src/lib/api/` = 0 lines).

**Template / docs**
- `templates/plugin/sticky-notes/plugin.json` (strict manifest)
- `templates/plugin/sticky-notes/ui/index.tsx` (full UI)
- `templates/plugin/sticky-notes/README.md`
- `.docs/plugin-sdk.implementation-plan.progress.md` (Fase 2 block)
- `backend/openapi.json` (regenerated, 28 routes)

**Untouched by design**
- `templates/plugin/{mermaid-renderer,logging-hook,research-agent}/plugin.json`
  (old manifest shape; rewritten in their own Fases — see progress doc)
- `templates/plugin/sticky-notes/backend/index.ts` (Fase 4)
- backend plugins module (Fase 1 complete)
