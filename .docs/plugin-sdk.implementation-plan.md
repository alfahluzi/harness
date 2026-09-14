# Plugin SDK Implementation Plan — Modular Agent Harness

Status: **Execution plan (v0.1)**
Companion: `.docs/plugin-sdk-strategy.md`
Scope: phased delivery of plugin SDK + sample plugins, with concrete tasks, dependencies, scaffolding, and verification gates.

---

## 0. Convention
- Caveman terse.
- Each task row: `<id> | <scope> | <files> | <deps> | <est> | <verify>`.
- IDs: `F<n>-T<m>` (Fase n Task m).
- Verify gate MUST exist for every task. No task = "build & pray".

---

## 1. Phase Graph

```
Fase 0 → Fase 1 → Fase 2 → Fase 3
                ↘            ↘
                 Fase 4 → Fase 5 → Fase 6 → Fase 7
```

Fase summaries (from `.docs/plugin-sdk-strategy.md` §10):

- **Fase 0** — Scaffolding. Bun workspaces, `packages/`, `agent/scripts/`, `templates/plugin/`.
- **Fase 1** — Foundation. Zod `PluginManifest` + list-only backend w/ `/api/plugins`.
- **Fase 2** — Frontend slots. `PluginHostProvider`, left bar + footer bar, sample `sticky-notes`.
- **Fase 3** — Chat + tool UI. `chatRenderers` + `toolUi` slots, `ChatMessage` schema migrate, sample `mermaid-renderer`.
- **Fase 4** — Backend hooks. `PluginHost.discoverAndLoad`, `transformSystemPrompt`, `extraAgents`, `tools` factory.
- **Fase 5** — Node lifecycle. `withPluginHooks` bridge, `callModel`+`callTool` wrap, `/api/plugins/hooks`, sample `logging-hook`.
- **Fase 6** — Custom graphs. Manifest `graphs[]`, `link-plugin-graphs.ts`, `dev.sh` wire, sample `research-agent`.
- **Fase 7** — SDK + publish. Publish `@puna/sdk-*`, CLI `puna plugin create|dev|build`, `plugin-authoring.md`.

---

## 2. Fase 0 — Scaffolding (prerequisite, NEW)

Strategy §10 assumes `packages/`, `agent/scripts/`, `templates/plugin/` exist. None do. Fase 0 ships them.

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F0-T1 | scaffold bun workspace | root `package.json` add `"workspaces": ["packages/*"]` | — | 1h | `bun install` exits 0; `ls packages/` shows new dirs. |
| F0-T2 | scaffold `packages/` skeleton | `mkdir -p packages/{sdk-shared,sdk-frontend,sdk-backend,sdk-agent,cli}` + per-pkg `package.json` (name `@puna/sdk-*`, `type: "module"`, peer deps) | F0-T1 | 2h | `bun pm ls` lists 5 packages. |
| F0-T3 | scaffold `agent/scripts/` | `mkdir -p agent/scripts` | — | 5m | `ls agent/scripts/` non-empty. |
| F0-T4 | scaffold `templates/plugin/` | `mkdir -p templates/plugin/{sticky-notes,mermaid-renderer,logging-hook,research-agent}` each w/ `plugin.json` + `ui/` + `backend/` + `README.md` stub | F0-T2 | 2h | `find templates/plugin -name plugin.json \| wc -l` = 4. |
| F0-T5 | document Fase 0 | append `.docs/plugin-sdk-strategy.md` §10 with Fase 0 above current Fase 1 | — | 30m | git diff shows new section. |

**Gate Fase 0 → Fase 1**: all 5 tasks verified.

---

## 3. Fase 1 — Foundation (Zod + list-only backend)

Pulled from strategy §10 Fase 1.

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F1-T1 | `PluginManifest` + `PluginSummary` Zod | `packages/sdk-shared/src/manifest.ts` | F0-T2 | 2h | zod parse against sample manifest OK; unknown-field rejection tested. |
| F1-T2 | layered discovery | `backend/src/modules/plugins/scanner.ts` reuse `mergeLayered` pattern (`backend/src/global/workspace-scanner.ts`) | F1-T1 | 3h | unit test: local wins, workspace-global wins, system-global wins; marker check. |
| F1-T3 | `PluginService` + `PluginHost` (list-only, no execute) | `backend/src/modules/plugins/{service,host}.ts` | F1-T2 | 4h | `GET /api/plugins` returns merged list w/ source layer. |
| F1-T4 | `/api/plugins` + `/api/plugins/{id}` routes | `backend/src/modules/plugins/route.ts` w/ `@hono/zod-openapi`; import schemas from `@puna/sdk-shared` (NOT redefine) | F1-T3 | 3h | `bun run openapi:dump` produces `PluginManifest` schema; `frontend bun run openapi-ts` regenerates client. |
| F1-T5 | update `backend/AGENTS.md` w/ plugins module entry | doc edit | F1-T3 | 15m | grep module name appears. |

**Gate Fase 1 → Fase 2**: routes listed in `/doc`; client typed end-to-end.

---

## 4. Fase 2 — Frontend slots + sticky-notes sample

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F2-T1 | `<PluginHostProvider>` + registry fetcher | `frontend/src/lib/plugins/{host.tsx,registry.ts,loader.ts}` | F1-T4 | 4h | provider boot logs `N plugins loaded`; no dynamic import errors. |
| F2-T2 | `<PluginSlot>` helpers | `frontend/src/lib/plugins/slots.tsx` | F2-T1 | 2h | renders N children; error boundary catches throw. |
| F2-T3 | leftBar slot injection at `u/route.tsx:124` | merge `usePluginRegistry().leftBar` into `DOCK_ITEMS` | F2-T2 | 2h | sample plugin leftBar entry appears in left dock. |
| F2-T4 | footerBar 3-region slot injection at `footer-bar.tsx` | wrap each region div | F2-T2 | 2h | sample footer counter renders in correct region. |
| F2-T5 | sample plugin: sticky-notes | `templates/plugin/sticky-notes/` complete | F2-T4 | 3h | enable via workspace conf, item visible, click persists. |
| F2-T6 | `PluginSummary.source` badge UI | left dock entry shows origin badge | F1-T4 | 2h | visual check. |

**Gate Fase 2**: sample plugin live in `frontend` (no backend execution). bun build OK.

---

## 5. Fase 3 — Chat renderers + tool UI + schema migration

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F3-T1 | `ChatMessage` schema migration | `frontend/src/lib/chat-types.ts` add optional `toolName?/args?/result?` per strategy §6.5 | F1-T1 | 1h | types compile; legacy `content`-only messages still render. |
| F3-T2 | adapter at `chat-request.tsx:86-99` | role dispatch reads `toolName` first | F3-T1 | 4h | tool role message w/ toolName renders via custom path; legacy tool role falls back. |
| F3-T3 | `chatRenderers` slot in chat-request | per-role render override | F3-T2 | 2h | sample renderer replaces default human/ai/tool rendering. |
| F3-T4 | `toolUi` slot in `MessageTool` | match by tool name | F3-T2 | 2h | sample mermaid renderer activates for tool named `mermaid`. |
| F3-T5 | sample plugin: mermaid-renderer | `templates/plugin/mermaid-renderer/` complete w/ `toolUi` | F3-T4 | 3h | tool call named `mermaid` renders diagram. |
| F3-T6 | UI bundle dev serve | `Bun.build` in `GET /api/plugins/{id}/ui-bundle` (dev mode) | F2-T1 | 4h | curl returns `text/javascript`; import in browser succeeds. |
| F3-T7 | React strict boundary per slot | error boundary wrap in `slots.tsx` | F2-T2 | 1h | throwing plugin doesn't crash app. |

**Gate Fase 3**: sample plugins visible in chat without backend reload.

---

## 6. Fase 4 — Backend hooks

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F4-T1 | `PluginHost.discoverAndLoad` execute | `backend/src/modules/plugins/loader.ts` dynamic import | F3-T6 | 4h | plugins loaded; `getLifecycleHooks()` non-empty. |
| F4-T2 | `transformSystemPrompt` pipeline | replace single-source `resolveSource` at `agent-runtime.ts:99` w/ transformer chain | F4-T1 | 4h | 2 plugins transformer compose; final prompt = base + plugin_a + plugin_b in declared order. |
| F4-T3 | `extraAgents` + `overrideAgentConf` merge in `AgentService` | `backend/src/modules/agents/service.ts` | F4-T1 | 3h | `GET /api/agents` returns core + plugin agents; override applies. |
| F4-T4 | `tools` factory → `.runtime/plugin-tools.json` + agent register | per strategy §5.4.1; backend invokes host tool via `/api/plugins/{id}/invoke` round-trip | F4-T1 | 6h | backend writes file; agent sub-process reads + registers; tool invocation round-trips. |
| F4-T5 | permissions enforcement | backend tool dispatch checks `permissions.fs/net/shell` | F4-T4 | 3h | disallowed host rejected; over-read path rejected. |

**Gate Fase 4**: tool calls end-to-end; permissions enforced; agent list merged.

---

## 7. Fase 5 — Node lifecycle (HTTP hooks)

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F5-T1 | `withPluginHooks` bridge | `agent/src/base/.libs/plugin-bridge.ts` w/ spread semantics (NOT `Object.assign`) | F4-T2 | 4h | unit test: `beforeNode` fires; `afterNode` patch merges immutably. |
| F5-T2 | wrap `callModel` + `callTool` | `agent/src/base/graph.ts:12-13` | F5-T1 | 3h | graph trace shows before/after invocations. |
| F5-T3 | `/api/plugins/hooks?workspace=...` RPC | backend route | F5-T1 | 2h | curl returns serialized hook list per workspace. |
| F5-T4 | sample plugin: logging-hook | `templates/plugin/logging-hook/` w/ `beforeNode` + `afterNode` | F5-T2 | 3h | graph run logs plugin-added metadata. |
| F5-T5 | hook timeout 5s | backend host enforces per strategy §12 Q3 | F4-T1 | 1h | slow hook logs + drops; graph still completes. |

**Gate Fase 5**: graph node transitions logged; timeout enforced.

---

## 8. Fase 6 — Custom graphs

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F6-T1 | manifest `graphs[]` resolver | `agent/scripts/link-plugin-graphs.ts` reads `/api/plugins/registry`, rewrites `agent/langgraph.json` | F4-T1 | 4h | diff shows generated entries; symlinks created in `agent/.plugins/<pluginId>/`. |
| F6-T2 | wire to `dev.sh` | add `bun run agent/scripts/link-plugin-graphs.ts` pre-step | F6-T1 | 1h | `bash dev.sh` regenerates langgraph.json + restarts. |
| F6-T3 | sample plugin: research-agent graph | `templates/plugin/research-agent/graphs/research.ts` | F6-T2 | 4h | graph listed in `langgraph.json`; LangGraph server picks up. |
| F6-T4 | namespace policy (host prepends `<pluginId>.<name>`) | tools + graphs; opt-in `alias` per strategy §12 Q4 | F4-T4, F6-T1 | 2h | two plugins w/ same tool/graph name don't collide. |

**Gate Fase 6**: ≥2 custom graphs registered via plugin; langgraph.json regenerated.

---

## 9. Fase 7 — SDK + publish

| ID | Scope | Files | Deps | Est | Verify |
|----|-------|-------|------|-----|--------|
| F7-T1 | publish `@puna/sdk-shared` to local Verdaccio OR link via `bun link` | `packages/sdk-shared/package.json` | F0-T2 | 2h | `bun pm ls` shows resolved version. |
| F7-T2 | repeat F7-T1 for sdk-frontend, sdk-backend, sdk-agent | per-pkg | F7-T1 | 4h | all 4 SDK pkgs resolvable from main project. |
| F7-T3 | `puna plugin create` CLI | `packages/cli/src/create.ts` scaffold from `templates/plugin/` | F7-T2 | 4h | `bun puna plugin create foo` produces `foo/` in cwd. |
| F7-T4 | `puna plugin dev` watch | `packages/cli/src/dev.ts` | F7-T3 | 3h | edit sample plugin → hot-reload visible in running app. |
| F7-T5 | `puna plugin build` prod bundle | `Bun.build` mode `production` | F7-T3 | 3h | output bundle minified; gzip ≤ 50KB for sample. |
| F7-T6 | `.docs/plugin-authoring.md` | how-to for plugin devs | F7-T3 | 4h | docs render; commands verified. |

**Gate Fase 7**: CLI commands end-to-end; docs published.

---

## 10. Cross-cutting Tasks (anytime)

| ID | Scope | Trigger | Est | Verify |
|----|-------|---------|-----|--------|
| CT-1 | update `frontend/AGENTS.md` plugin section | after Fase 2 | 30m | grep shows. |
| CT-2 | update `backend/AGENTS.md` plugin module rule | after Fase 1 | 30m | grep shows. |
| CT-3 | sample plugins tested per OS (linux/darwin) | after each sample lands | ongoing | CI matrix green. |
| CT-4 | performance budget: plugin load ≤100ms p95 | Fase 2 + Fase 7 | ongoing | timing logged. |

---

## 11. Risk Register

From strategy §12 open questions + audit findings.

| ID | Risk | Mitigation | Owner |
|----|------|------------|-------|
| R1 | Plugin tool namespace collision | F6-T4 host-prepends `<pluginId>.<name>`; alias opt-in | Fase 6 |
| R2 | Tailwind utility collision across plugins | F2 sample narrow; v2 CSS-modules (out of scope v1) | Fase 2 + revisit |
| R3 | Hook timeout cascade | F5-T5 5s + drop per strategy Q3 | Fase 5 |
| R4 | LangGraph restart latency on plugin toggle | acceptable per strategy Q1 | — |
| R5 | Two sources of truth (sdk-shared vs route Zod) | F1-T4 import line in `route.ts` (no redefine) | Fase 1 |
| R6 | Tool flow backend→agent hop cost | acceptable low-freq; revisit if measured | Fase 4 |
| R7 | PluginMarket v1 trust model | document; signature in v2 (out of scope) | post-v1 |
| R8 | `mergeLayered` semantics: same id different versions | later layer replaces earlier (current behavior); document | Fase 1 doc |

---

## 12. Verification Matrix

Per-Fase checklist (must pass before next Fase opens):

- [ ] **Fase 0**: 5/5 tasks verified. `bun install` OK. `bun pm ls` 5 pkgs. `templates/plugin/` has 4 `plugin.json`.
- [ ] **Fase 1**: `/api/plugins` + `/api/plugins/{id}` in `/doc`. OpenAPI client regenerated. No Zod duplication in route.
- [ ] **Fase 2**: sample `sticky-notes` visible in left dock + footer counter region. `bun build` OK. Error boundary tested.
- [ ] **Fase 3**: `mermaid-renderer` activates on tool name. Legacy `content`-only messages still render. Throwing plugin doesn't crash app.
- [ ] **Fase 4**: tool round-trip works. Permissions enforced (`fs`/`net`/`shell`). `GET /api/agents` merged.
- [ ] **Fase 5**: graph trace shows hook metadata. Slow hook logs + drops after 5s.
- [ ] **Fase 6**: ≥2 graphs in `langgraph.json` via plugin. `dev.sh` regenerates. Namespace policy applied.
- [ ] **Fase 7**: CLI `create|dev|build` work end-to-end. Sample bundle gzip ≤ 50KB. Docs render.

---

## 13. Out of Scope (echo strategy §11)
- Marketplace
- Signature
- Cross-plugin deps
- CSS scoping v2
- Auto-update

---

## 14. References
- `.docs/plugin-sdk-strategy.md` (companion)
- `.docs/plugin-sdk-strategy.md` §5.4.1 (tool flow)
- `.docs/plugin-sdk-strategy.md` §6.5 (ChatMessage schema)
- `.docs/plugin-sdk-strategy.md` §10 (migration plan — source of fase summaries)
- `.docs/plugin-sdk-strategy.md` §12 (open questions — risk register source)
- `backend/AGENTS.md`
- `frontend/AGENTS.md`
- `backend/src/global/workspace-scanner.ts` (`mergeLayered`)
- `backend/src/global/agent-runtime.ts` (`resolveSource` at L99)
- `agent/src/base/.libs/configuration.ts`
- `agent/src/base/tools/index.ts` (`getAllTools`, `filterTools`)
- `frontend/src/layout/left-bar.tsx` (props-driven contract)

---

## 15. Status Log

| Date | Fase | Task | Status | Notes |
|------|------|------|--------|-------|
|      |      |      |        |       |