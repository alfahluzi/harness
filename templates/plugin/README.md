# templates/plugin

Sample plugin archetypes — one per Fase that needs an executable demo.

| Archetype | Kind | Slots / hooks / graphs | Fase |
|-----------|------|------------------------|------|
| `sticky-notes` | ui | `leftBar`, `footerBar.right` | Fase 2 (F2-T5) |
| `mermaid-renderer` | ui | `toolUi:mermaid` | Fase 3 (F3-T5) |
| `logging-hook` | agent-hook | `beforeNode`, `afterNode` | Fase 5 (F5-T4) |
| `research-agent` | graph | `graphs: [research]` | Fase 6 (F6-T3) |

Each archetype ships a `plugin.json` (Zod-validated manifest), `ui/`, `backend/`, and `README.md`.

`puna plugin create <name>` (Fase 7) scaffolds a new plugin by copying one of these archetypes.