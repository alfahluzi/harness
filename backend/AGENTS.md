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
│   └── tasks.ts           # Table definitions only
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
