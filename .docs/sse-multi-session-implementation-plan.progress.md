# Progress: SSE Multi-Session Implementation Plan

> Companion to `.docs/sse-multi-session-implementation-plan.md`.
> Tracks executed phases, results, deviations, and open items.

---

## Fase 1 — Backend (independen) — DONE

**Status:** implemented + verified.
**Lane:** `@fixer` (ses_f818d8142ffeAJBneqpT1gKD5E).
**Scope:** 4-file backend refactor per plan §Fase 1 + integration test (audit-mandated).

### Changes

| File | Status | Lines | Purpose |
|---|---|---|---|
| `backend/src/global/stream-bus.ts` | NEW | 143 | `StreamEvent` envelope, `StreamBus` singleton (EventEmitter + per-run `seq` Map), `ConnectionMux` (bounded queue drop-oldest, 15s heartbeat, optional workspace filter via injectable resolver) |
| `backend/src/modules/sessions/service.ts` | REFACTOR | 534 | Removed `streamMessage`/`streamRun`; added `withThreadLock` per-childThreadId mutex, `startRun` (detached `consumeRunToBus(...).catch()`), `cancelRun` (best-effort), `getSessionWorkspace`, public getters `langgraphClient`/`repository`; module-level `consumeRunToBus` (persist-before-`done`, cancel-vs-error classification, notifyParent in finally) |
| `backend/src/modules/sessions/route.ts` | REFACTOR | 374 | POST `/sessions/:id/stream` → JSON 202 (no SSE body); NEW POST `/sessions/:id/cancel`; NEW GET `/sessions/stream` firehose (plain Hono, registered before `/sessions/:id`); exported `setStreamBusWorkspaceResolver` |
| `backend/src/modules/sessions/schema.ts` | MINOR | 34 | Added `CancelSessionInput` alias |
| `backend/src/server.ts` | WIRING | 134 | Boot-time `setStreamBusWorkspaceResolver((id) => sessionService.getSessionWorkspace(id))` |
| `backend/src/modules/sessions/service.test.ts` | NEW | 438 | 8 bun:test cases covering bus + mux + startRun |

### Audit-fix coverage in Fase 1

| # | Fix | Location |
|---|---|---|
| 2 | `.catch()` on detached `consumeRunToBus` → terminal envelope + persist | service.ts startRun |
| 3 | `withThreadLock` per-thread mutex around `assertThreadIdle` + `runs.create` | service.ts |
| 4 | `repo.setResult` before `streamBus.publish("done")` | consumeRunToBus |
| 5 | Bounded FIFO queue per controller, drop-oldest (cap 1000) | stream-bus.ts ConnectionMux |
| 6 | `: keepalive\n\n` every 15s while attached | stream-bus.ts ConnectionMux |
| 7 | MVP single-user posture noted; `?workspaceId=` filter via resolver | stream-bus.ts + service.ts |
| 9 | try/catch on `joinStream`, cancel vs error classification, `cancelled` envelope | consumeRunToBus |

Fase-2 fixes (#1, #8, #10, #11, #12) land with frontend work in Fase 2.

### Verification (re-run by orchestrator)

- `bunx tsc --noEmit` → 0 errors
- `bun test src/modules/sessions/` → **8 pass / 0 fail** (21 expect() calls)
- `bun test` (full backend) → 98 pass / 1 pre-existing fail
  - Pre-existing fail (`agent-runtime.test.ts > falls back to first model of first provider`) reproduced on base commit `bdd53f1` — unrelated to this lane. Flagged below.
- `bun run openapi:dump` → confirmed `POST /sessions/{id}/stream` returns `{202,400,404,409}` (no `text/event-stream`); `POST /sessions/{id}/cancel` registered; GET `/sessions/stream` absent from spec (plain Hono — intentional per plan §1c)
- Runtime smoke: `GET /api/sessions/stream` → 200 text/event-stream; unknown-id stream/cancel → 404 JSON

### Deviations from plan (with rationale)

1. **`getSessionWorkspace` returns `undefined` instead of throwing** — a throw inside the bus listener would break every `publish`. Resolver swallows the throw so non-existent sessions just don't match the filter.
2. **`consumeRunToBus` uses public `repository` getter + public `notifyParent`** — TS `private` is class-scoped, so the module-level helper needed accessor exports. Plan only specified a getter for `langgraph_client`; added one for `repo` too.
3. **`ConnectionMux` subscribes in constructor (not `attach`)** — publishes-before-attach buffer into the bounded queue, required for the relay test ordering and matches the plan's "firehose from the start" intent.
4. **`ConnectionMuxOptions` exposed** (`bus`, `queueCap`, `heartbeatMs`) — keeps the mux testable without monkey-patching `setInterval`.
5. **Test DB via temp-file `SQLITE_PATH`** (not `:memory:`) — `:memory:` + WAL pragma leaks `-wal`/`-shm` files into cwd.

### Open items (from Fase 1)

- **Pre-existing `agent-runtime.test.ts` failure** ("falls back to first model of first provider") contradicts the current `agent-runtime.ts` behavior (defaultModel wins before firstModelForProvider). Reproduced on base commit. **Unrelated to this plan** — flag for separate lane if the test contract needs to be re-aligned with the new precedence rule. Do not bundle into Fase 2.
- **Hono route registration order** — `/sessions/stream` must register before any `/sessions/:id` pattern. Comment in `route.ts` documents the constraint. If Hono is upgraded and static-priority semantics change, re-verify.

---

## Fase 2 — Frontend — PENDING

Blocked on:
- ✅ Fase 1 complete (above)
- ⏭️ `openapi:dump` already re-run → frontend client regen

Next lane: `@fixer` for 5-file frontend refactor (chat-types.ts, stream.ts, chat-session-store.ts, stream-provider.tsx, routes/u/chat/index.tsx). Kontrak envelope fixed by Fase 1; verifier: 2-session parallel E2E + reconnect + cancel-isolation.
