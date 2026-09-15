# Product Requirements Document (PRD)

> One PRD per project. Source of truth for product requirements.
> Update only when requirements change and the change is confirmed.

## 1. Overview

- **Project name:** puna
- **Owner:** aldi-rudexylo
- **Status:** draft
- **Last updated:** 2026-09-15

puna adalah agent harness: CLI global (`puna`) + control plane project-local `.puna/` + backend API (Hono/OpenAPI) + frontend React (TanStack Router) + agent runtime berbasis LangGraph + plugin SDK. Distribusi npm: `@aldi-rudexylo/puna` (v0.1.0, MIT, public). Product dalam pengembangan aktif; status per plan: plugin SDK Fase 0–3 + workspace migration selesai (Fase 4–7 pending), SSE multi-session Fase 1–2 ter-merge (follow-up pending), session-manager Fase 1–3 shipped (Fase 4 hardening todo).

## 2. Purpose & Goals

- Menyediakan harness agent yang di-install global, sementara seluruh konfigurasi dan artefak project tetap project-local di `.puna/`.
- Memisahkan global executable dari project workspace; workspace punya persistent identity (`workspace.id`) yang tidak bergantung pada absolute path, sehingga session/history tetap relevan saat project dipindah.
- Menjalankan dan mengorkestrasi agent runtime, backend API, dan frontend UI lewat satu command (`puna serve`).
- Mendukung banyak session paralel dalam satu koneksi streaming (SSE firehose) dengan run yang detached dari koneksi client.
- Membuka extension surface untuk plugin pihak ketiga tanpa fork monorepo.
- Menjadikan filesystem `.puna/` sebagai source of truth workspace, sementara state runtime (session, message, task, tool call) disimpan di database dan direferensikan lewat `workspace_id`.

## 3. Target Users

- **Developer pengguna CLI** — install global `@aldi-rudexylo/puna`, jalankan `puna init` di project, edit `.puna/agents|skills|docs/plan`, lalu `puna serve`. (Sumber: `README.npm.md`, `src/init.js`.)
- **Operator/dev harness penuh** — clone repo, jalankan `install.sh` / `dev.sh` untuk backend + frontend + agent; `puna serve` mensyaratkan sibling `agent/`, `backend/`, `frontend/`. (Sumber: `README.npm.md`, `install.sh`, `dev.sh`.)
- **Plugin author** — menulis plugin manifest-first (`plugin.json`), memakai `@puna/sdk-*` dan (rencana) CLI `puna plugin create|dev|build`. (Sumber: `docs/plans/plugin-sdk/plan.md`, `packages/README.md`.)
- **Pengguna frontend workspace UI** — chat multi-session serta kelola workspace, MCP, agents, dan skills dari left bar. Multi-user/multi-tenant belum didukung karena auth dan filter workspace belum diimplementasikan. (Sumber: `frontend/src/routes/u/route.tsx`, `docs/plans/sse-multi-session/plan.md`.)

## 4. Features (In Scope)

| ID | Feature | Priority | Notes |
| --- | --- | --- | --- |
| F-1 | `puna init` — inisialisasi workspace `.puna/` + bootstrap global config | must | Shipped. Membuat `config.json` (`id` ULID `ws_*`, `version`), `docs/plan/`, `README.md`, `.gitignore`; bootstrap `~/.config/.puna/` berisi default agents + skills; idempotent (refresh), ada mode `--global`. Sumber: `src/init.js`, `README.npm.md`, `package.json` (`postinstall`). |
| F-2 | Workspace identity & discovery | must | Shipped. `id` persisten + `root`/`cwd`/`configDir`; pencarian `.puna/` ke atas dari `cwd`; `cwd` bukan `root`. Sumber: `src/serve.js` (`findPuna`, `loadWorkspaceContext`), `.docs/workspace-architecture.md`, `backend/src/global/workspace-context.ts`. |
| F-3 | `puna serve` — orkestrasi backend + agent + frontend, plus `--check` | must | Shipped. Deteksi workspace, tampilkan banner context, validasi (`--check`), spawn 3 service dengan prefix log, graceful shutdown. Batasan: butuh repo harness lokal (sibling dir). Sumber: `src/serve.js`, `README.npm.md`. |
| F-4 | Layered resolution agents & skills (workspace-local > global) | must | Shipped. Marker `prompt.md` (agent) dan `desc.md` (skill); nama sama = local menang, nama beda = additive. Plugins memakai 3 lapis (local > workspace-global > system-global). Sumber: `src/serve.js` (`mergeLayered`), `src/init.js`, `backend/AGENTS.md`, `docs/plans/plugin-sdk/plan.md`. |
| F-5 | Agent runtime LangGraph | must | Shipped. Graph dengan node `call-llm`/`call-tool`, tools file/shell/http/sql/memory, SQLite checkpointer, MCP client untuk session tools; dijalankan via `langgraphjs dev`. Sumber: `agent/package.json`, `agent/src/base/graph.ts`, `agent/src/base/.libs/checkpointer.ts`, `agent/src/base/tools/`. |
| F-6 | Backend API sessions (REST + OpenAPI) | must | Shipped. `POST/GET /api/sessions`, detail, result, message, messages, stream, cancel, restart, switch-branch, delete; spec di `/doc`, client frontend di-generate. Sumber: `backend/src/modules/sessions/route.ts`, `backend/src/server.ts`, `frontend/AGENTS.md`. |
| F-7 | SSE multi-session streaming | must | Fase 1–2 ter-merge; follow-up post-merge pending. Satu koneksi SSE per client (firehose `GET /api/sessions/stream`), banyak session dimultiplex via envelope `sessionId + runId + seq`; `POST /api/sessions/:id/stream` mengembalikan `202 {runId}`; run detached dari koneksi; heartbeat 15s; `POST /api/sessions/:id/cancel`. Frontend: store per-session (Zustand) + provider 1 koneksi app-lifetime dengan reconnect backoff. Sumber: `docs/plans/sse-multi-session/plan.md`, `backend/src/global/stream-bus.ts`, `frontend/src/lib/stream.ts`, `frontend/src/components/stream-provider.tsx`, `frontend/src/store/chat-session-store.ts`. |
| F-8 | SessionManager via MCP (spawn sub-agent LangGraph) | should | Fase 1–3 shipped; Fase 4 hardening todo. Expose `SessionManager` ke proses agent lewat MCP Streamable HTTP (`/mcp`, 5 tools: create/status/result/message/delete session); parent thread-id disuntik di sisi agent; REST dan MCP berbagi instance service yang sama; graceful shutdown `cancelAll`. Sumber: `docs/plans/session-manager/plan.md`, `backend/src/server.mcp.ts`, `agent/src/base/tools/mcp-client.ts`. |
| F-9 | Backend API providers (LLM provider) | should | Shipped. `GET/POST/PATCH/DELETE /api/providers`, `GET /api/providers/:id/models`, `POST /api/providers/test`, `POST /api/providers/connect`; kind `openai / anthropic / google / openrouter / custom`; target `local / global`; `apiKey` tidak pernah diekspos di response. Sumber: `backend/src/modules/providers/schema.ts`, `backend/src/modules/providers/route.ts`. |
| F-10 | Backend API agents | must | Shipped. `GET /api/agents` dan `GET /api/agents/:name`, merged dari layer workspace-local + workspace-global (2 lapis). Sumber: `backend/src/modules/agents/route.ts`, `backend/AGENTS.md`. |
| F-11 | Backend API skills | must | Shipped. `GET /api/skills` dan `GET /api/skills/:name`, merged 2 lapis dengan marker `desc.md`. Sumber: `backend/src/modules/skills/route.ts`, `backend/AGENTS.md`. |
| F-12 | Backend API MCPs (registry + install) | should | Shipped. `GET /api/mcps/search`, `GET /api/mcps/registry/:name`, `GET /api/mcps/installed`, `POST /api/mcps/install`, uninstall. Sumber: `backend/src/modules/mcps/route.ts`, `backend/src/modules/mcps/registry.ts`. |
| F-13 | Backend API workspaces (discover) | should | Shipped. `GET /api/workspaces/discover` scan rekursif root (default `~`, max depth 10) untuk direktori `.puna/` + baca `workspace.id`. Sumber: `backend/src/modules/workspaces/route.ts`, `backend/src/global/workspace-scanner.ts`. |
| F-14 | Plugin SDK (backend/frontend/agent packages) | must | Fase 0–3 + workspace migration selesai; Fase 4–7 pending. Manifest-first `plugin.json` (Zod strict, semver, path-traversal guard); discovery 3 lapis dari `.puna/plugins/<name>/` dan `~/.config/puna/plugins/`; endpoint `GET /api/plugins` + `/api/plugins/{id}`; frontend slots `leftBar`, `footerBar`, `chatRenderers`, `toolUi`; backend hooks (system prompt, extra agents, tools, permissions) dan node lifecycle direncanakan Fase 4–5. Packages: `@puna/sdk-shared`, `@puna/sdk-frontend`, `@puna/sdk-backend`, `@puna/sdk-agent`, `@puna/cli`. Sumber: `docs/plans/plugin-sdk/plan.md`, `packages/README.md`, `backend/src/modules/plugins/route.ts`, `backend/AGENTS.md`. |
| F-15 | Plugin templates + CLI `puna plugin` | should | Templates shipped (4 archetype: `sticky-notes`, `mermaid-renderer`, `logging-hook`, `research-agent`); CLI `puna plugin create / dev / build` masih Fase 7. Sumber: `templates/plugin/README.md`, `packages/cli/`, `docs/plans/plugin-sdk/plan.md`. |
| F-16 | Frontend chat UI & navigation | must | Shipped untuk alur chat. Route `/u/chat` dengan panel chat, renderer per role (human/ai/tool), markdown; left bar untuk chat/workspace/MCP/agents/skills/settings; footer bar menyediakan region slot plugin. Sumber: `frontend/src/routes/u/chat/`, `frontend/src/layout/`, `frontend/AGENTS.md`. |
| F-17 | Default agent profiles: Semar, Cepot, Dawala, Gareng | should | Templates shipped dan di-install `puna init` ke global config (`~/.config/.puna/agents/`); runtime me-resolve profile by name via `agentProfile`. Flow orkestrasi `Semar → Gareng → Dawala → Cepot → Semar` baru di level design doc/prompt. Sumber: `.docs/default-agent.md`, `templates/agents/`, `src/init.js`, `backend/src/global/agent-runtime.ts`. |
| F-18 | Skills & plan templates | must | Shipped. Skill global: `create-agent`, `create-skill`, `planning` (scripts `list.sh`, `create.sh`, `advance.sh`); artefak perencanaan project-local `docs/plan/<name>.md` (source of truth rencana) + `<name>.progress.md` (progress log). Sumber: `src/init.js`, `templates/skills/`, `templates/skills/planning/desc.md`, `.docs/workspace-architecture.md`, `.puna/README.md`. |

## 5. Out of Scope

- **`puna serve` setelah global install** — `serve` mensyaratkan sibling `agent/`, `backend/`, `frontend/` di repo harness; package npm global hanya membawa CLI. (Sumber: `README.npm.md`, `src/serve.js`.)
- **SSE multi-session MVP** — auth multi-tenant + filter user/workspace penuh (firehose saat ini mengirim semua session ke semua client, posture existing tanpa auth), replay buffer event (bus tidak menyimpan histori), strategi subscribe/unsubscribe via side-channel, backpressure lanjutan. (Sumber: `docs/plans/sse-multi-session/plan.md`.)
- **SessionManager Fase 4/open decisions** — durable registry (Redis/SQLite; registry in-memory tidak survive restart backend), `p-queue` pengganti polling `acquireSlot`, `docker-compose.yml`, perubahan logic `SessionManager` itu sendiri. (Sumber: `docs/plans/session-manager/plan.md`.)
- **Plugin SDK v1** — marketplace/discovery UI, cryptographic signature verification, cross-plugin dependency resolution, CSS scoping v2, plugin auto-update. (Sumber: `docs/plans/plugin-sdk/plan.md`.)
- **Secret di `.puna/`** — credential, API key, token, atau secret tidak boleh disimpan di dalam directory workspace. (Sumber: `.docs/workspace-architecture.md`.)

## 6. Success Metrics

Metrik sukses produk **belum didefinisikan** di sumber mana pun. Yang tersedia baru gate engineering per plan (misalnya gate Fase 7 plugin-sdk: bundle sample plugin gzip ≤ 50KB dan plugin load ≤ 100ms p95; gate Fase 1–2 SSE: test integrasi firehose + manual E2E). Belum ada target adopsi, performa produk, atau metrik bisnis. Detail dan usulan metrik dicatat di Open Questions; angka apa pun tidak boleh dikarang sebelum ada keputusan.

## 7. Open Questions

1. **Naming `.nusa` vs `.puna`** — `.docs/workspace-architecture.md` masih memakai `.nusa/` dan command `nusa`, sedangkan produk saat ini memakai `.puna/` dan `puna`. Perlu keputusan nama kanonik dan status migrasi dokumen.
2. **Status implementasi default agent profiles** — templates + instalasi via `puna init` dan resolusi `agentProfile` di runtime sudah ada, tetapi SDD `docs/default-agents/SDD.md` masih scaffold kosong dan flow orkestrasi Semar/Cepot/Dawala/Gareng belum terbukti terimplementasi sebagai graph (baru prompt-level). Perlu verifikasi end-to-end.
3. **Distribusi & monetisasi harness** — package publik MIT, tetapi belum ada keputusan cara `serve` untuk user global install (bundle penuh, installer, atau `npm link`), apakah harness akan didistribusikan penuh, dan model monetisasinya (tidak ada informasi di sumber).
4. **Kematangan plugin SDK** — plan menyatakan Fase 0–3 selesai dan Fase 4–7 pending, tetapi `backend/AGENTS.md` menyebut modul plugins Fase 1 list-only tanpa ui-bundle, padahal route `/api/plugins/{id}/ui-bundle` sudah ada. Perlu verifikasi status aktual, drift dokumen, dan target publish SDK (`Verdaccio` vs `bun link`).
5. **Field kanonik `config.json`** — `.puna/README.md` menyebut `config.json` berisi "workspace id + cwd", sementara `src/init.js` menulis `id` + `version` + `globalConfigDir`. Field mana yang kanonik dan perlu didokumentasikan?
6. **Metrik sukses** — belum ada metrik produk; perlu definisi target yang terukur (adopsi, reliability streaming, latensi run, stabilitas plugin) sebelum status PRD naik dari draft.
7. **SSE follow-up** — kapan auth + filter workspace dikerjakan sebagai gate sebelum multi-user production (audit #7), apakah replay buffer dibutuhkan, dan strategi backpressure final.
8. **Session-manager Fase 4** — durable registry (Redis/SQLite), `p-queue`, `docker-compose.yml`, dan verifikasi `config.graphId` vs `client.assistants.search()` masih open decision/accepted-risk.

## 8. Change Log

| Date | Change | Author |
| --- | --- | --- |
| 2026-09-15 | Initial PRD derived from repo docs (README.npm.md, plans, .docs/) via docs-manager refactor | docs-manager refactor |
