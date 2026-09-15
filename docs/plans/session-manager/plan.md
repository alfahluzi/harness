# Session Manager via local MCP server

Status: Fase 1–3 shipped (`ccd7778` + `801dc9d`, path implementasi sudah berevolusi dari draft awal); Fase 4 hardening masih `todo`.

## Tujuan

Expose `SessionManager` backend (spawn sub-agent LangGraph: create/status/result/message/delete) ke proses `agent/` lewat protokol MCP, tanpa duplikasi logic dan tanpa hand-written `fetch()` wrapper. Agent memuat tool session otomatis sebagai LangChain tools, dan parent thread-id disuntik di sisi agent sehingga LLM tidak perlu tahu atau mengetik thread id-nya sendiri.

## Keputusan Arsitektur

- **MCP Streamable HTTP di proses Bun/Hono yang sudah ada, route `/mcp`.** `SessionManager` tetap long-lived dan in-memory (registry task, counter concurrency, SDK client LangGraph). Stdio ditolak: ia mem-spawn server sebagai subprocess, artinya instance `SessionManager` kedua yang tidak berbagi state. Server MCP dibangun dari `@modelcontextprotocol/sdk` + `@hono/mcp`, dimount di app Hono — file `backend/src/server.mcp.ts`.
- **Agent sebagai MCP client via `@langchain/mcp-adapters`.** `MultiServerMCPClient` connect ke `http://localhost:3001/mcp`, `getTools()` menghasilkan LangChain-compatible tools — file `agent/src/base/tools/mcp-client.ts`.
- **Wrapper injeksi parent thread-id.** Tool `create_session` dari MCP dibungkus `tool()` tipis di sisi agent; `config.configurable.thread_id` disuntik diam-diam sebagai arg `parent` sebelum delegasi ke tool MCP asli. Schema yang dilihat LLM tidak memuat `parent`.
- **REST route tetap ada** untuk debug/frontend; REST dan MCP memanggil instance `SessionManager` yang sama, jadi tidak ada duplikasi logic — hanya dua transport surface.

```
agent/ (MultiServerMCPClient) --MCP Streamable HTTP--> backend /mcp --> SessionManager --> LangGraph SDK
```

## Scope

**In:**

- Backend: config (`backend/src/global/config.ts`), zod schema session (`backend/src/modules/sessions/schema.ts`), service registry + concurrency slot + `notifyParent` (`backend/src/modules/sessions/service.ts`), MCP server wrap 5 tools (`backend/src/server.mcp.ts`), mount `/mcp` + REST route + graceful shutdown (`backend/src/index.ts`).
- Agent: MCP client + wrapper injeksi parent (`agent/src/base/tools/mcp-client.ts`), registrasi tool (`agent/src/base/tools/index.ts`).
- Verifikasi end-to-end testing checklist (handshake, 5 tools, injeksi parent, sync/async, transisi status/result, notifyParent, send/delete, SIGINT).

**Out (defer ke Fase 4 / open decisions):**

- Durable registry (Redis/SQLite) — registry in-memory tidak survive restart backend; acceptable untuk MVP.
- `p-queue` — `acquireSlot` masih polling `setTimeout`.
- `docker-compose.yml` — connectivity antar container dan verifikasi `config.graphId` vs `client.assistants.search()`.
- Perubahan logic `SessionManager` itu sendiri.

## Phase Breakdown

### Fase 1 — Backend (SessionManager + MCP server)

- `config.ts` (`langgraphUrl`, `graphId`, `maxConcurrency`) → realita: `backend/src/global/config.ts`.
- Zod schema `CreateSessionInput`, `SessionIdInput`/`TaskIdInput`, `SendMessageInput` → realita: `backend/src/modules/sessions/schema.ts`.
- `SessionManager`/`SessionService`: registry task, concurrency slot, `notifyParent` → realita: `backend/src/modules/sessions/service.ts`.
- MCP server membungkus service sebagai 5 MCP tools → realita: `backend/src/server.mcp.ts`.
- Mount `/mcp` (Streamable HTTP) + REST route di app Hono → realita: `backend/src/modules/sessions/route.ts` + `backend/src/index.ts`.
- Graceful shutdown: `cancelAll` saat SIGINT/SIGTERM → realita: `backend/src/index.ts`.

**Gate:** backend boot, handshake `/mcp` merespons independen dari agent; semua task Fase 1 `completed` di `task.json`.

### Fase 2 — Agent MCP client

- `mcp-client.ts`: `MultiServerMCPClient` + wrapper injeksi thread-id sebagai `parent`.
- Registrasi MCP-derived tools di registry tool agent.

**Gate:** `loadSessionManagerTools()` mengembalikan 5 tools tanpa throw saat backend hidup.

### Fase 3 — Verifikasi

- Jalankan testing checklist: handshake `/mcp`, `loadSessionManagerTools` 5 tools, `create_session` injeksi parent, background sync/async, transisi status/result, `notifyParent`, `send_session_message`, `delete_session`, SIGINT.

**Gate:** seluruh checklist lulus atau kegagalan terdokumentasi eksplisit.

### Fase 4 — Hardening / open decisions

- `docker-compose.yml`: connectivity antar proses (agent/backend/frontend) di level network container, bukan `localhost`.
- Durable registry (Redis/SQLite) supaya task survive restart backend.
- Ganti polling `acquireSlot` dengan `p-queue`.
- Verifikasi `config.graphId` vs `client.assistants.search()`.

**Gate:** tiap open decision ditutup atau dieksplisitkan sebagai accepted-risk.

## Status & Cara Membaca

`task.json` di folder ini adalah **source of truth** progress — bukan chat history. CLI dijalankan dari root project:

```bash
~/.config/opencode/skills/project-plan-manager/bin/plan-manager plan_status --plan session-manager
~/.config/opencode/skills/project-plan-manager/bin/plan-manager phase_list --plan session-manager
~/.config/opencode/skills/project-plan-manager/bin/plan-manager task_list --plan session-manager --phase <p>
~/.config/opencode/skills/project-plan-manager/bin/plan-manager task_get_progress --plan session-manager --phase <p> --task <t>
```

Catatan: implementasi sudah shipped dan berevolusi dari draft awal — `backend/lib/*` menjadi `backend/src/global/config.ts`, `backend/src/modules/sessions/{schema,service,route}.ts`, `backend/src/server.mcp.ts`; sisi agent tetap `agent/src/base/tools/mcp-client.ts` + `index.ts`. Progress note per task mencatat path realita ini.
