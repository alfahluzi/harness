# packages/

Bun workspaces for plugin SDK + CLI.

| Package | Scope | Status |
|---------|-------|--------|
| `@puna/sdk-shared` | Zod `PluginManifest`, source-layer enum, shared types | Fase 1 |
| `@puna/sdk-frontend` | `<PluginHostProvider>`, `<PluginSlot>`, registry loader | Fase 2 + Fase 3 |
| `@puna/sdk-backend` | `PluginHost`, scanner, `/api/plugins` routes, hooks | Fase 1 + Fase 4 + Fase 5 |
| `@puna/sdk-agent` | `withPluginHooks` bridge, `callModel`/`callTool` wrap | Fase 5 |
| `@puna/cli` | `puna plugin create|dev|build` | Fase 7 |

All packages use `type: "module"` and resolve via `workspace:*` protocol.