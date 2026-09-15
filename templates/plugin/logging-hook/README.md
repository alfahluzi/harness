# logging-hook

Backend-side `beforeNode` + `afterNode` hooks (Fase 5). Logs every node transition.

## How it runs

- Hooks execute **inside the backend process** (Hono), not in the agent.
- The agent sub-process invokes them over the backend RPC:
  - `GET /api/plugins/hooks?configDir=...` — descriptor discovery (does any plugin declare hooks?).
  - `POST /api/plugins/hooks?configDir=...` — one request per phase (`beforeNode` / `afterNode`) with `{ phase, node, state, config }`.
- Logs are written to the **backend stdout** as `[plugin:logging-hook] -> before <node>` / `<- after <node>` with a message-count summary.
- `afterNode` intentionally returns **no state patch** (`void`), so the RPC response carries `patch: null` and graph state is left untouched.

Declared via `capabilities.backendHooks` in `plugin.json` (`entry: backend/index.ts`, default export).
