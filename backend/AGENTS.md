# Backend Architecture Rules

## Directory Structure

```
src/
├── server.ts              # Main server entry point (REST, MCP, middleware)
├── server.mcp.ts          # MCP server setup (tools, transport)
├── global/                # Shared utilities used by 2+ modules
│   ├── config.ts          # App configuration (env vars, defaults)
│   └── db.ts              # Database connection (SQLite, Drizzle)
├── models/                # Drizzle ORM schema definitions
│   └── sessions.ts        # Table definitions only
└── modules/
    └── <feature>/
        ├── route.ts       # Hono route handlers + OpenAPI schemas
        ├── schema.ts      # Zod validation schemas (input/output)
        ├── service.ts     # Business logic (OOP class)
        └── repository.ts  # Database queries (OOP class)
```

## Module Isolation Rule

Modules are **closed** by default. A module CANNOT import from another module.

**Forbidden:**
```ts
// src/modules/sessions/service.ts
import { someFunction } from "../other-module/service"; // ❌
```

**Allowed:**
```ts
// src/modules/sessions/service.ts
import { config } from "../../global/config"; // ✅
import { sqliteDb } from "../../global/db";   // ✅
```

## Shared Code Rule

If logic is:
1. Repetitive across 2+ modules
2. Generic (not feature-specific)

Then place it in `src/global/<utility-name>.ts`.

**Examples:**
- `src/global/errors.ts` — shared error classes
- `src/global/auth.ts` — authentication middleware
- `src/global/pagination.ts` — pagination helpers

## File Responsibilities

### `route.ts`
- Hono route definitions with OpenAPI schemas
- Request validation (params, body, query)
- Delegates to service layer
- Never contains business logic

### `schema.ts`
- Zod schemas for input validation
- Type exports inferred from schemas
- No database or API logic

### `service.ts`
- Business logic class
- Orchestrates repository calls
- Handles external API calls (LangGraph, etc.)
- Manages concurrency, retries, state transitions
- No raw SQL — use repository

### `repository.ts`
- Database query class
- Prepared statements or Drizzle queries
- Row-to-record mapping
- No business logic — pure data access

### `models/`
- Drizzle table definitions only
- One file per table
- No queries, no business logic

### `global/`
- Shared utilities, config, database connection
- Can be imported by any module
- No feature-specific logic

## Class Pattern

All services and repositories use OOP:

```ts
// Correct
export class SessionService {
  private repo: TaskRepository;
  
  constructor(repo: TaskRepository = new TaskRepository()) {
    this.repo = repo;
  }
  
  async create(opts: CreateOpts) { ... }
}

// Wrong — avoid singletons and procedural exports
export const createSession = async () => { ... };
export const sessionService = new SessionService();
```

## Import Order

Within a module, import in this order:
1. External packages
2. Global utilities (`../../global/...`)
3. Sibling files (`./schema`, `./repository`, `./service`)

## Adding a New Module

1. Create `src/modules/<feature>/` directory
2. Create `schema.ts` with Zod validation
3. Create `repository.ts` with database queries
4. Create `service.ts` with business logic
5. Create `route.ts` with Hono routes
6. Add model to `src/models/` if new table needed
7. Register routes in `src/server.ts`

## Plugins Module

`src/modules/plugins/` is a deliberate deviation from the standard template:

- **3-layer scan**: uses `mergeLayered3` (workspace-local + workspace-global +
  system-global via `defaultSystemPluginDir()`), unlike the 2-layer
  agents/skills/mcps which use `mergeLayered`. Local wins on collision.
- **No `schema.ts`**: `route.ts` imports `PluginManifest`, `PluginSummary`,
  `PluginSource`, and `PluginKind` from `@puna/sdk-shared` — the SDK package is
  the single source of truth for frontend + backend. Only response envelopes
  (`PluginsListResponse`, `PluginDetailResponse`) are declared inline.
- **No `repository.ts`**: Fase 1 is filesystem-only (`plugin.json` marker); no
  DB tables yet.
- **`host.ts`** holds a module-level `pluginHost` singleton. Fase 1 stub is
  superseded by the Fase 4 execution host: `discoverAndLoad` builds a
  `LoadedPlugin` snapshot (loader failures stored as `loadError` with
  `instance: null`), `getSystemPromptTransformers`/`applySystemPromptTransforms`,
  `getExtraAgents`, `applyAgentConfOverrides`, `getTools` (namespaced
  `<pluginId>.<name>`, strategy §12 Q4), `writeToolDescriptors`
  (`.runtime/plugin-tools.json`, descriptors only, strategy §5.4.1),
  `checkPermission`, and `enforceTools` all work. `setLoaded` is kept for
  Fase 1 back-compat. Fase 5 implements `getLifecycleHooks`/`runNodeHook`
  (HTTP hooks executed in the backend process; the agent calls
  `GET`/`POST /api/plugins/hooks`), with `getPluginHostForWorkspace` caching
  one host per workspace `configDir`. Fase 6 implements `getGraphs()` returning
  namespaced `PluginGraphDescriptor[]` (`<namespace>.<alias ?? id>`, host-owned
  prefix, authors never write the prefix, via `resolveGraphKey` from
  `@puna/sdk-shared`).
- **`service.ts`** exports the `PluginService` class (no singleton export);
  plugin identity is the manifest `id`, so `GET /plugins/:id` resolves by
  manifest, not directory name.
- Fase 1 is **list-only**: no hooks, registry, or ui-bundle routes (the
  ui-bundle read route landed in Fase 3).

### Fase 4 backend hooks (new files)

- **`contract.ts`** — types only (`BackendPlugin`, `LoadedPlugin`,
  `StructuredTool`, `PromptContext`, `AgentConf`, …), mirroring strategy §5.3.
  No runtime code.
- **`loader.ts`** — `loadBackendModule(resolvedDir, manifest)` dynamic-imports
  the `capabilities.backendHooks` / `capabilities.tools` entry via
  `await import(absolutePath)` (Bun runs plugin TS directly). Honors
  `capability.export` (default `"default"`, incl. `default.tools` for bare tool
  factories), supports object default exports, factory default exports, and
  named exports. Returns `null` when neither capability is declared; wrap
  failures with the plugin id + entry path.
- **`permissions.ts`** — `PermissionEnforcer` + `PermissionDeniedError`.
  `fs.read`/`fs.write` use exact-or-prefix matching on `safeRelativePath`
  patterns, `net` is exact hostname, `shell` is exact command.
- **AgentService merge is intentionally NOT done in this module**: `AgentService`
  is a sibling module and cross-module imports are forbidden. `getExtraAgents()` /
  `applyAgentConfOverrides()` expose the merged data; the `agents` module (or a
  future `global/` bridge) is responsible for wiring it into `/api/agents`.
- **Permission policy** (strategy §8): v1 plugins are user-installed and trusted,
  so `getTools()` applies no checks. `enforceTools()` is the opt-in integration
  point — it returns the same namespaced tools with a bound
  `verify(action, target)` that consults `checkPermission`.
