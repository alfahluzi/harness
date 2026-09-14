# mermaid-renderer

Sample plugin archetype that demonstrates the `toolUi` capability: it replaces
the default mono bubble for tool calls whose name is `mermaid`.

## What it does

When a tool-role message carries `toolName === "mermaid"`, the host renders
`toolUi.mermaid` instead of the default `MessageTool` bubble. The component:

- reads the Mermaid source from `args.source` (falls back to `args.code`,
  then `args.diagram`),
- shows a **Copy** button that writes the source to the clipboard (with a
  transient `Copied` state),
- optionally renders `result` below the source when the tool call completed.

It activates purely on the tool name — no backend round-trip, no permissions.

## Activation

1. Copy or symlink this directory into a plugin layer:
   - workspace-local: `<workspace>/.puna/plugins/mermaid-renderer/`
   - system-global: `~/.config/puna/plugins/mermaid-renderer/`
2. Enable the plugin for the workspace in its config (the plugin must be
   present in the scanned layer).
3. Restart the frontend dev server.

Fase 3 loads plugin UI through the static loader map
(`frontend/src/lib/plugins/loader.ts`); the key for this plugin is
`mermaid-renderer::toolUi::toolUi`. The loader imports this module and resolves
the named export `toolUi`.

## Manifest shape

```json
{
  "$schema": "https://puna.dev/schemas/plugin.v1.json",
  "id": "mermaid-renderer",
  "name": "Mermaid Renderer",
  "version": "0.1.0",
  "description": "Custom toolUi renderer for tool calls named `mermaid`. Renders the raw Mermaid source with copy-to-clipboard and a syntax-highlighted preview block.",
  "author": "Puna",
  "license": "MIT",
  "engines": { "puna": ">=0.1.0" },
  "capabilities": {
    "toolUi": { "entry": "ui/index.tsx", "export": "toolUi" }
  }
}
```

## Capability notes

- `capabilities.toolUi` uses a `CapabilityEntry`: `entry` is the plugin-relative
  module path (`ui/index.tsx`), `export` is the named export the loader resolves
  (`toolUi`).
- `toolUi` is an **object keyed by tool name**, not a single component. The host
  picks the entry whose key matches `msg.toolName`; the first matching key wins.
  This template declares exactly one key: `mermaid`.
- The component receives `{ msg, args?, result? }`. `args`/`result` are the
  structured tool-call payloads added to `ChatMessage` in F3-T1.
- No `permissions` are declared — the renderer only reads props and writes to
  the clipboard.

## Limitations

Fase 3 does **not** render actual SVG/PNG diagrams from Mermaid source. The
component displays the raw Mermaid text (plus a copy button and the optional
tool result). A real Mermaid runtime integration is out of scope and tracked as
a follow-up (Fase 7+).

## Backend

None. `backend/index.ts` is an empty default export kept for symmetry with the
other archetypes; `capabilities.backendHooks` is not declared.

## Files

| File | Purpose |
|------|---------|
| `plugin.json` | Strict `PluginManifest` declaring `capabilities.toolUi` → `ui/index.tsx` export `toolUi`. |
| `ui/index.tsx` | `MermaidDiagram` component + `toolUi` keyed object; raw source, copy button, optional result. |
| `backend/index.ts` | Empty default export — no backend hooks or tools. |
| `README.md` | This document. |

Status: Fase 3 implemented (F3-T5).
