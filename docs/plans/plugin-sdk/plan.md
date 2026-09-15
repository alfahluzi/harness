# Plugin SDK — Modular Agent Harness

Status: Fase 0–3 + Workspace Migration selesai (26/48 task); Fase 4–7 + sisa cross-cutting pending. Sumber kebenaran status = `task.json`.

## Tujuan

Buka extension surface untuk plugin pihak ketiga tanpa fork monorepo:

1. Menu + panel baru di left bar.
2. Widget di footer bar.
3. Ganti/extend renderer pesan chat (human/ai/tool).
4. Extend system prompt + before/after node execution + daftar/konfigurasi agent.
5. Register tool baru + UI render tool call sendiri.
6. Register LangGraph baru di LangGraph server.

Plugin loadable dari workspace (`.puna/plugins/<name>/`) dan/atau system-wide (`~/.config/puna/plugins/`), layered seperti agents/skills/mcps (workspace-local > workspace-global > system-global). Marker file: `plugin.json`.

## Scope

**In scope:**

- Manifest-first: `plugin.json` Zod strict (reject unknown field, semver, path-traversal guard).
- Layered discovery 3 lapis + best-effort list.
- Frontend slots: `leftBar`, `footerBar`, `chatRenderers`, `toolUi`; error boundary per slot.
- Backend hooks: `transformSystemPrompt`, `extraAgents`, `overrideAgentConf`, `tools` factory, permissions `fs`/`net`/`shell`.
- Node lifecycle: `withPluginHooks` (beforeNode/afterNode) via HTTP bridge, timeout 5s.
- Custom graphs: manifest `graphs[]` + `link-plugin-graphs.ts` + wire `dev.sh`.
- SDK `@puna/sdk-{shared,frontend,backend,agent}` + CLI `puna plugin create|dev|build` + docs authoring.

**Out of scope (v1):**

- Marketplace / discovery UI.
- Cryptographic signature verification.
- Cross-plugin dependency resolution.
- CSS scoping v2 — plugin share Tailwind utility global; CSS-modules di slot boundary ditunda.
- Plugin auto-update.

## Phase Breakdown

### Fase 0 — Scaffolding

Scaffold bun workspace, `packages/` (5 pkg SDK), `agent/scripts/`, `templates/plugin/` (4 archetype).
**Gate:** 5/5 task verified. `bun install` exit 0. `bun pm ls` 5 pkg. `templates/plugin/` punya 4 `plugin.json`.

### Fase 1 — Foundation (Zod + list-only backend)

`@puna/sdk-shared` (`PluginManifest`/`PluginSummary`), scanner 3 lapis (`mergeLayered3`), module `plugins/` (service/host/route) list-only, endpoint `/api/plugins` + `/api/plugins/{id}`.
**Gate:** route terdaftar di `/doc`; client typed end-to-end; tidak ada duplikasi Zod di `route.ts`.

### Fase 2 — Frontend slots + sticky-notes sample

`PluginHostProvider` + registry/loader/slots di `@puna/sdk-frontend`; inject `leftBar` di `u/route.tsx` + 3 region `footerBar`; sample `sticky-notes`; badge `PluginSummary.source`.
**Gate:** sample live di frontend tanpa eksekusi backend; `bun build` OK; error boundary teruji.

### Fase 3 — Chat renderers + tool UI + schema migration

`ChatMessage` + `toolName/args/result` (opsional); role dispatch di `chat-request.tsx`; slot `chatRenderers` + `toolUi`; sample `mermaid-renderer`; dev serve `GET /api/plugins/{id}/ui-bundle` (`Bun.build`); strict boundary per slot.
**Gate:** sample plugin tampil di chat tanpa reload backend; pesan legacy `content`-only tetap render; plugin yang throw tidak crash app.

### Fase 4 — Backend hooks

`PluginHost.discoverAndLoad` execute; pipeline `transformSystemPrompt`; merge `extraAgents` + `overrideAgentConf` di `AgentService`; `tools` factory → `.runtime/plugin-tools.json` + register di agent; enforcement permissions `fs`/`net`/`shell`.
**Gate:** tool call end-to-end; permissions enforced; `GET /api/agents` merged (core + plugin).

### Fase 5 — Node lifecycle (HTTP hooks)

`withPluginHooks` bridge di agent (spread semantics, bukan `Object.assign`); wrap `callModel` + `callTool`; RPC `/api/plugins/hooks?workspace=...`; sample `logging-hook`; timeout 5s + drop.
**Gate:** transisi node graph ter-log; hook lambat drop setelah 5s; graph tetap selesai.

### Fase 6 — Custom graphs

Resolver manifest `graphs[]` (`agent/scripts/link-plugin-graphs.ts`) rewrite `langgraph.json`; wire ke `dev.sh`; sample `research-agent` graph; namespace policy host prepend `<pluginId>.<name>`.
**Gate:** ≥2 graph custom terdaftar via plugin; `langgraph.json` ter-regenerate.

### Fase 7 — SDK + publish

Publish `@puna/sdk-*` (Verdaccio / `bun link`); CLI `puna plugin create|dev|build`; `.docs/plugin-authoring.md`.
**Gate:** CLI end-to-end; bundle sample gzip ≤ 50KB; docs render.

### Workspace Migration — unified bun workspace

Migrasi `backend/` + `frontend/` ke root bun workspace; `bunfig.toml` isolated linker; hapus lockfile per-app; dedupe zod; symlink SDK dikelola bun.
**Gate:** `bun install` root OK; `bun pm ls` 7 workspace entry; 58/58 test; openapi regen 28 route; `PluginManifest` jadi named `components.schemas`.

### Cross-cutting

Update `frontend/AGENTS.md` + `backend/AGENTS.md`; test sample plugin per OS (linux/darwin); performance budget plugin load ≤ 100ms p95.
**Gate:** grep section AGENTS.md hijau; sample plugin lulus di linux/darwin; timing p95 ter-log.

## Referensi

- [plugin-sdk-strategy.md](references/plugin-sdk-strategy.md) — strategi, arsitektur, manifest, permission, migration plan.
- [plugin-sdk-fase2-verify.md](references/plugin-sdk-fase2-verify.md) — bukti verify Fase 2 (visual-check stub).

## Task Tracking

`task.json` = sumber kebenaran status task (jangan edit manual). Baca via CLI:

```sh
plan-manager plan_status --plan plugin-sdk
plan-manager phase_list --plan plugin-sdk
plan-manager task_list --plan plugin-sdk --phase <id>
```
