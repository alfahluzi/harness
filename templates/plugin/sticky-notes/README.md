# sticky-notes

Persistent notes + counter widget for the Plugin SDK sample.

- **Capabilities**: `leftBar` (`StickyNotesEntry`) + `footerBar`
  (`StickyNotesCounter`) — both exported from `ui/index.tsx`.
- **Persistence**: `localStorage` key `puna:plugin:sticky-notes:v1` (Fase 2).
  The `fs` write permission on `.puna/notes/` is declared in `plugin.json` but
  not consumed until Fase 4 wires backend hooks.
- **Backend**: `backend/index.ts` stays a Fase 0 stub; no hooks in Fase 2.

Status: Fase 2 implemented (F2-T5).
