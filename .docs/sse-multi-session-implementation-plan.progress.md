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

## Fase 2 — Frontend — DONE

**Status:** implemented + verified by orchestrator.
**Lane:** `@fixer` (Sisyphus-Junior / `deep` category, ses_f80c12804ffeqmfyOQozUmIeLj).
**Scope:** 5-file frontend refactor per plan §Fase 2 + `__root.tsx` mount + `package.json` dep + `frontend/src/lib/api/*` regen.

### Changes

| File | Status | Purpose |
|---|---|---|
| `frontend/src/lib/chat-types.ts` | MINOR | Added `StreamEvent` envelope type (audit #10: hand-shared comment, drift-checked against backend) |
| `frontend/src/lib/stream.ts` | REFACTOR | Removed `streamChatMessage`; added `startRun` (POST→202 `{runId}`), `cancelRun`, `connectStream` (GET firehose → `onEvent(StreamEvent)`) |
| `frontend/src/store/chat-session-store.ts` | NEW (249) | Zustand v5 per-session store: `applyEvent` (per-`(runId, seq)` dedup + same-run ai-merge), `applyHistory` (content-dedup vs live, audit #8), `appendHuman` (optimistic + dedup), `reset`, `getSession`; module-level `sessionTracker` (Set + listeners) + `useSessionSubscription` hook (audit #12: ref-counted lazy-connect) |
| `frontend/src/components/stream-provider.tsx` | NEW (131) | Single app-lifetime firehose. `useSyncExternalStore` on `sessionTracker.count`. Exp backoff 1s→30s + ±20% jitter (audit #11). 5s idle-close on ref-count=0. AbortController used only for firehose transport teardown (NOT for run cancel) |
| `frontend/src/routes/__root.tsx` | WIRING | `<StreamProvider baseUrl={API_BASE_URL}>` wraps `<Outlet />` |
| `frontend/src/routes/u/chat/index.tsx` | REFACTOR (326→291) | Removed local `messages`/`isStreaming`/`streamContent`/`AbortController`; reads from `useChatSessionStore` with stable selectors; `submitMessage` calls `startRun` fire-and-forget then `setActiveRun`; `handleStop` calls `cancelRun` (not AbortController); auto-submit guard now reads store status |
| `frontend/package.json` | +1 dep | `zustand ^5.0.15` — required for store + subscriber semantics, smallest dep surface |
| `frontend/src/lib/api/*.gen.ts` | REGEN | `openapi:dump` + `npm run openapi-ts` re-run; 5 generated files now present (was the root cause of 55 of the 57 baseline tsc errors) |
| `backend/openapi.json` | REGEN | Dumped from booted backend (port 3001, `/doc`); 24 routes |
| `backend/data/shared.db` | SCHEMA FIX | `bun run db:push` — `config_dir` column was missing on the live DB (the model declared it but the migration history didn't add it). Without this fix `openapi:dump` could not start the server |

### Audit-fix coverage in Fase 2

| # | Fix | Location |
|---|---|---|
| 8 | backfill vs live overlap deduped by message content (not seq) | `chat-session-store.ts` `applyHistory` (prefix-drop trailing ai + re-append live tail with content-merge at the junction) |
| 10 | envelope type hand-shared, drift-checked at write time | `chat-types.ts` `StreamEvent` (matches `backend/src/global/stream-bus.ts` field-for-field; verified, zero drift) |
| 11 | reconnect exponential backoff + jitter | `stream-provider.tsx` `scheduleReconnect` (1s→2s→4s→…→30s cap, `delay * (0.8 + Math.random() * 0.4)`) |
| 12 | lazy connect (firehose only open while at least one session subscribed) | `stream-provider.tsx` + `sessionTracker` ref count + 5s idle-close |
| (plan §2b) | cancel is `cancelRun` POST, not AbortController on the firehose | `chat/index.tsx` `handleStop`; `stream-provider.tsx` AbortController only aborts the firehose transport itself |

Fase-1 audit fixes 1, 2, 3, 4, 5, 6, 7, 9 closed in Fase 1 (see above).

### Verification (re-run by orchestrator)

- `bun run openapi:dump` (backend) → wrote `openapi.json` (24 routes)
- `npm run openapi-ts` (frontend) → 5 files generated in `src/lib/api/`
- `bunx tsc --noEmit` (frontend) → **0 errors in all Fase-2-touched files**. Repo exit 2 with 2 pre-existing errors only (`src/routes/u/route.tsx` lines 6 + 170: unused `NavigationPanel` import + unused `handleResizeStart` declaration) — unrelated to this lane, present on base commit, flagged below.
- `npm run lint` → exit 0, 0 error-severity lines. Net unique warnings 17→16 (fixed a baseline `exhaustive-deps` in `left-bar.tsx`). No new warnings on Fase-2 files. `only-export-components` on `chat/index.tsx` and `__root.tsx` are pre-existing pattern (the agent moved `useSessionSubscription` to `chat-session-store.ts` to avoid a NEW warning from `stream-provider.tsx`).
- Greps:
  - `streamChatMessage` → 0 matches in `frontend/src`
  - `AbortController` → only in `stream-provider.tsx` (firehose transport teardown; per spec)
  - `as any` / `@ts-ignore` / `@ts-expect-error` / `eslint-disable` → 0 matches in touched files
- Drift check: frontend `StreamEvent` ↔ backend `stream-bus.ts` → field-for-field identical, zero drift.
- Store semantics smoke-tested by the lane agent (bun, not shipped): per-run seq dedup, duplicate-skip with no re-render, parallel-session isolation, `error` keeps messages, `done` → idle + clears activeRunId, `cancelled` terminal, sequential runs never merge turns, backfill-vs-live dedup in both orderings, optimistic-human dedup.

### Deviations from plan (with rationale)

1. **`useSessionSubscription` + `sessionTracker` live in `store/chat-session-store.ts`, not `stream-provider.tsx`** — oxlint `react/only-export-components` forbids non-component exports from a component file; keeping the 0-new-warnings gate clean. Behavior identical.
2. **`SessionState` adds `lastRunId`** beyond the plan's literal shape — without it, consecutive runs in one session merged into a single AI bubble (smoke-tested). Merge now happens only within the same run.
3. **`applyEvent` accepts LangGraph `type` ("ai"/"human"/"tool") in addition to the app's `role` alias** — Fase-1's backend relays `part.data` as message tuples where the message uses `type`. Verified against `@langchain/langgraph-sdk` `MessagesTupleStreamEvent` shape; the literal `role` check would render nothing. Backend untouched.
4. **`applyEvent` sets `status: "streaming"` on `messages` events** (plan enumerated only error/cancelled/done) — required for reload-mid-run to show streaming UI, and because `startRun` is fire-and-forget so the "streaming" status needs to be visible before the first envelope arrives.
5. **`applyHistory` implements #8 as prefix-drop + re-append of the live tail** (covers "sama / superset" per the audit amendment) — strictly stronger than the literal "same content" wording; prevents losing events applied before backfill resolves.
6. **`chat/index.tsx` `onSuccess`/`onError` params explicitly typed** — inherited baseline TS7006 from the broken generated client; fixed locally since they blocked clean-tsc on this file.
7. **Schema fix on `backend/data/shared.db`** (off-plan but blocking) — `config_dir` was missing from the live DB despite being in the model; `bun run db:push` applied the change so `openapi:dump` could boot the server.

### Open items (from Fase 2)

- **2 pre-existing tsc errors in `src/routes/u/route.tsx`** (unused `NavigationPanel` import + unused `handleResizeStart` declaration). Not introduced by this lane — present on base commit. Suggested for a follow-up lane that does a one-line cleanup pass on `u/route.tsx`. Do not bundle into a Fase-3 lane if one is created.
- **oxlint warnings in `chat/index.tsx`** (`only-export-components` on line 30, `set-state-in-effect` on line 139) and `__root.tsx` (`only-export-components`) — pre-existing pattern across every route file. Not a Fase-2 regression.
- **No automated E2E for 2-session parallel / reconnect / cancel-isolation.** Plan §Fase 2 verification lists these as "Manual E2E." Lane scoped tsc + lint + grep + drift + smoke-test only. Recommend a follow-up lane to add Playwright or bun-driven E2E before merge to a production branch (audit #7 multi-tenant gate remains in scope for that work).
- **MVP single-user posture carries forward unchanged from Fase 1** — firehose sends all sessions to all clients; auth + per-workspace filter remain blocked behind the audit #7 gate.
- **Frontend `bun test` infrastructure not added by this lane.** No unit tests for the store / provider. Acceptable for MVP per plan scope, but recommended to add before the E2E follow-up.

---

## Next steps (post-merge)

1. **E2E lane** (recommended): 2-session parallel streaming, switch-mid-run, idle >60s reconnect, cancel-doesn't-affect-other-session. Playwright or bun-driven.
2. **Auth + per-workspace filter** (audit #7, production gate): out of MVP scope, blocks multi-tenant merge.
3. **Per-`u/route.tsx` cleanup**: drop the 2 unused exports flagged above.
4. **Store + provider unit tests** (Zustand + `connectStream` mocked): would let the drift check live in CI.
