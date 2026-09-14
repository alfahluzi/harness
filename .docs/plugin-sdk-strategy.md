# Plugin SDK Strategy — Modular Agent Harness

Status: **Proposal (v0.1)**
Scope: end-to-end plugin system covering frontend UI extension points, backend
runtime hooks, tool/graph registration, and packaging/distribution.

---

## 1. Tujuan

Membuka enam extension surface berikut untuk plugin pihak ketiga tanpa
memfork monorepo:

1. Menu baru di [`left-bar.tsx`](../frontend/src/layout/left-bar.tsx) +
   `NavigationPanel` custom.
2. Widget baru di [`footer-bar.tsx`](../frontend/src/layout/footer-bar.tsx).
3. Replace/extend chat message renderer
   ([msg-human](../frontend/src/routes/u/chat/-components/msg-human.tsx),
   [msg-ai](../frontend/src/routes/u/chat/-components/msg-ai.tsx),
   [msg-tool](../frontend/src/routes/u/chat/-components/msg-tool.tsx)).
4. Replace/extend system prompt + before/after node execution + agent list +
   agent conf (backend `agent/` + `agent-runtime`).
5. Register tool baru dengan UI component sendiri untuk render tool call.
6. Register LangGraph baru di LangGraph server (`agent/langgraph.json`).

Semua **loadable dari workspace** (`.puna/plugins/<name>/`) dan/atau
system-wide (`~/.config/puna/plugins/`) — mengikuti layered discovery yang
sudah dipakai `agents/`, `skills/`, `mcps/`.

---

## 2. Prinsip

- **Zero fork.** Plugin adalah folder di `.puna/plugins/`. Tidak menyentuh
  source tree utama.
- **Layered seperti fitur existing.** Reuse
  [`mergeLayered()`](../backend/src/global/workspace-scanner.ts) — local >
  workspace-global > system-global. Marker file: `plugin.json`.
- **Manifest-first.** Setiap plugin punya `plugin.json` (Zod-validated).
  Manifest deklaratif; kode hanya di-load kalau capability-nya dideklarasi.
- **Sandbox by default.** Frontend plugin dieksekusi lewat dynamic import
  ES module. Backend plugin runtime tidak boleh `import`
  cross-module — tetap tunduk pada [module isolation rule](../backend/AGENTS.md).
- **Contract stable, wiring bebas.** SDK expose *interfaces* + host services;
  implementasi plugin bebas (React component, LangGraph node fn, dsb).
- **Reversible.** Enable/disable plugin = toggle di conf, tidak butuh reinstall.

---

## 3. Direktori Layout

```
.puna/                             # workspace (existing)
├── agents/
├── skills/
├── mcps/
└── plugins/                       # NEW
    └── <plugin-name>/
        ├── plugin.json            # manifest (marker file)
        ├── ui/                    # optional — frontend bundle
        │   └── index.js           # ESM entry, default export = PluginModule
        ├── backend/               # optional — backend hooks
        │   └── index.ts           # ESM entry, default export = BackendPlugin
        ├── graphs/                # optional — LangGraph modules
        │   └── <graph-id>.ts
        ├── tools/                 # optional — tool factories
        │   └── <tool-id>.ts
        └── assets/                # icons, images
```

System-wide: `~/.config/puna/plugins/<name>/` — same layout.

---

## 4. Manifest (`plugin.json`)

```jsonc
{
  "$schema": "https://puna.dev/schemas/plugin.v1.json",
  "id": "com.example.notes",
  "name": "Notes",
  "version": "0.1.0",
  "description": "Sticky notes panel in the left bar.",
  "author": "Aldi",
  "license": "MIT",
  "engines": { "puna": ">=0.2.0" },

  "capabilities": {
    "leftBar":       { "entry": "ui/index.js", "export": "leftBar" },
    "footerBar":     { "entry": "ui/index.js", "export": "footerBar" },
    "chatRenderers": { "entry": "ui/index.js", "export": "chatRenderers" },
    "toolUi":        { "entry": "ui/index.js", "export": "toolUi" },

    "backendHooks":  { "entry": "backend/index.ts" },
    "tools":         { "entry": "backend/index.ts", "export": "default.tools" },
    "graphs":        [
      { "id": "notes-agent", "entry": "graphs/notes-agent.ts", "export": "graph", "namespace": "com.example.notes" }
    ]
    // Adapter (§5.5): <namespace>/<id> → <entry>:<export> in agent/langgraph.json.
  },

  // tools export references the default-export BackendPlugin's .tools method (see §5.3).
  "permissions": {
    "fs":  { "read": ["${workspace}/notes"] },
    "net": { "hosts": ["api.example.com"] }
  }
}
```

Manifest divalidasi Zod di
`backend/src/modules/plugins/schema.ts` — reject on unknown fields, semver
validation, path-traversal check pada `entry`.

---

## 5. Backend Architecture

### 5.1 New module: `backend/src/modules/plugins/`

Mengikuti pola module yang sudah ada (route/schema/service/repository):

```
backend/src/modules/plugins/
├── route.ts          # /api/plugins CRUD + /manifest bundle
├── schema.ts         # Zod: PluginManifest, PluginSummary
├── service.ts        # PluginService: discover, validate, enable/disable
└── loader.ts         # dynamic import + lifecycle
```

Endpoint:

| Method | Path                            | Purpose                       |
|--------|--------------------------------|-------------------------------|
| GET    | `/api/plugins`                  | List (layered, mirip agents)  |
| GET    | `/api/plugins/{id}`             | Manifest + resolved paths     |
| GET    | `/api/plugins/{id}/ui-bundle`   | Serve UI ESM bundle           |
| POST   | `/api/plugins/{id}/enable`      | Toggle in workspace conf      |
| POST   | `/api/plugins/{id}/disable`     | ...                            |
| GET    | `/api/plugins/registry`         | Merged capability index untuk frontend boot |
| GET    | `/api/plugins/hooks?workspace=...` | RPC: hooks for agent sub-process (see §5.4) |

### 5.2 Host services (`backend/src/global/plugin-host.ts`)

Singleton yang dipanggil di `server.ts` on boot:

```ts
export class PluginHost {
  private loaded = new Map<string, LoadedPlugin>();

  async discoverAndLoad(configDir: string): Promise<void>
  getLifecycleHooks(): AgentLifecycleHook[]
  getTools(): StructuredTool[]
  getGraphs(): Record<string, CompiledGraph>
  getSystemPromptTransformers(): PromptTransformer[]
}
```

`PluginHost` dipakai oleh:
- `agent-runtime.ts` — merge system prompt via `PluginHost.getSystemPromptTransformers()` pipeline (replace `resolveSource` single-pick at L99); register additional tools via `buildRuntimeTools` patch; panggil `beforeNode`/`afterNode` hook.
- `agent/src/base/graph.ts` — untuk optional pre/post node wrapper (lihat 5.4).
- `agents` route (`/api/agents`) — untuk merge plugin-declared agent profiles.

### 5.3 Backend plugin contract

```ts
// SDK export (packages/sdk-backend/src/index.ts)
export interface BackendPlugin {
  id: string;

  // Prompt transformation
  transformSystemPrompt?: (ctx: PromptContext, prompt: string) => string | Promise<string>;

  // Node lifecycle (LangGraph)
  beforeNode?: (nodeName: string, state: GraphState, cfg: RunnableConfig) => Promise<void>;
  afterNode?:  (nodeName: string, state: GraphState, cfg: RunnableConfig) => Promise<Partial<GraphState> | void>;

  // Agent list extension
  extraAgents?: () => Promise<AgentSummary[]>;

  // Agent conf overlay (merged after workspace agent conf)
  overrideAgentConf?: (agentName: string, conf: AgentConf) => AgentConf;

  // Tool contribution
  tools?: (config: ToolsConfig) => StructuredTool[];
}
```

### 5.4 Node execution hook wiring

Modify [`agent/src/base/graph.ts`](../agent/src/base/graph.ts) supaya
`callModel` dan `callTool` di-wrap oleh `withPluginHooks(nodeFn, nodeName)`:

```ts
// agent/src/base/.libs/plugin-bridge.ts (NEW)
export function withPluginHooks<N extends string>(
  name: N,
  fn: (state, cfg) => Promise<Partial<State>>,
) {
  return async (state, cfg) => {
    const hooks = await fetchPluginHooks(cfg);  // via HTTP to backend
    for (const h of hooks) await h.beforeNode?.(name, state, cfg);
    const out = await fn(state, cfg);
    for (const h of hooks) {
      const patch = await h.afterNode?.(name, { ...state, ...out }, cfg);
      // Spread (not Object.assign) to preserve LangGraph reducer immutability semantics.
      if (patch) return { ...out, ...patch };
    }
    return out;
  };
}
```

`fetchPluginHooks` = single HTTP round trip ke backend `/api/plugins/hooks?workspace=...`.
Agent process itu **sub-process terpisah** (LangGraph server), jadi
komunikasi via HTTP, bukan direct import.

### 5.4.1 Tool flow (backend host → agent sub-process)

`PluginHost.getTools()` lives di backend (satu proses dengan Hono).
Agent sub-process (`agent/`, jalan via LangGraph server) **tidak** punya akses
direct ke backend process. Pengiriman tool:

1. Saat backend boot: `PluginHost.discoverAndLoad()` aggregate `StructuredTool[]`.
2. Backend serializes tool descriptor (name + JSON schema input, **bukan** implementation)
   ke file `.runtime/plugin-tools.json` di workspace.
3. Agent sub-process baca file di boot, lalu register tool via existing
   `agent/src/base/tools/index.ts` factory — implementation callable via
   HTTP RPC ke backend `/api/plugins/{id}/invoke` (tool name → backend dispatch).
4. Capability/permission check di backend host sebelum tool implementation jalan.

Trade-off: extra HTTP hop per tool call. Acceptable karena tool freq rendah
dibanding LLM tokens. Alternative (in-process shared memory) revisit jika
latency terasa.

### 5.5 Custom LangGraph registration

`langgraph.json` di-generate dynamic on dev script:

```jsonc
// agent/langgraph.json (generated)
{
  "graphs": {
    "graph": "./src/base/graph.ts:graph",
    "com.example.notes/notes-agent": "./.plugins/notes-agent/graph.ts:graph"
  }
}
```

Script `agent/scripts/link-plugin-graphs.ts` (bagian dari `dev.sh`):
1. Panggil `GET /api/plugins/registry`.
2. Symlink `agent/.plugins/<pluginId>/graph.ts -> <resolvedPath>`.
3. Rewrite `langgraph.json`.
4. Restart LangGraph server.

Alternatif jangka pendek: manifest `graphs[]` cukup di-list, dan langgraph.json
di-hand-edit dulu. Automate saat plugin count > 5.

---

## 6. Frontend Architecture

### 6.1 Runtime plugin loader

```
frontend/src/lib/plugins/
├── host.tsx        # <PluginHostProvider> — fetches registry on boot
├── loader.ts       # dynamic import(bundleUrl)
├── registry.ts     # in-memory PluginRegistry (React context)
└── slots.tsx       # <PluginSlot name="leftBar" /> helpers
```

Boot flow (di `main.tsx`):

1. `<PluginHostProvider>` fetch `GET /api/plugins/registry`.
2. Untuk setiap plugin enabled, `import(/* @vite-ignore */ bundleUrl)`.
3. Cache module dan populate slot maps.

### 6.2 SDK contract (frontend)

```ts
// packages/sdk-frontend/src/index.ts
export interface PluginModule {
  leftBar?: LeftBarContribution;
  footerBar?: FooterBarContribution;
  chatRenderers?: ChatRendererContribution;
  toolUi?: ToolUiContribution;
}

export interface LeftBarContribution {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  route?: string;               // if navigates
  panel?: React.ComponentType;  // if in-place nav panel
}

export interface FooterBarContribution {
  id: string;
  position?: "left" | "center" | "right";
  order?: number;
  component: React.ComponentType;
}

export interface ChatRendererContribution {
  // Match predicate + replacement. Undefined = fallback to core.
  human?: (msg: ChatMessage) => React.ReactNode | undefined;
  ai?:    (msg: ChatMessage, opts: { streaming?: boolean }) => React.ReactNode | undefined;  // adapter at chat-request.tsx:86-99
  tool?:  (msg: ChatMessage) => React.ReactNode | undefined;
}

export interface ToolUiContribution {
  // Keyed by tool name. Renders inline inside msg-tool.tsx.
  [toolName: string]: React.ComponentType<{ msg: ChatMessage; args: unknown; result?: unknown }>;
}
```

### 6.3 Wiring per surface

**Left bar** — [`u/route.tsx`](../frontend/src/routes/u/route.tsx) build
`DOCK_ITEMS` dari core statik **+** `usePluginRegistry().leftBar` array.
No structural change ke `LeftBar` itself; ia sudah generic.

**Footer bar** — refactor [`footer-bar.tsx`](../frontend/src/layout/footer-bar.tsx):

```tsx
<footer>
  <div>{coreLeft}   <PluginSlot name="footerBar" position="left"   /></div>
  <div>            <PluginSlot name="footerBar" position="center" /></div>
  <div>{coreRight} <PluginSlot name="footerBar" position="right"  /></div>
</footer>
```

**Chat renderers** — ubah call sites di
`frontend/src/routes/u/chat/-components/chat-request.tsx` (L86-99, tempat msg-*
 dipilih oleh role-based dispatch) supaya:

```tsx
const custom = registry.chatRenderers?.human?.(msg);
return custom ?? <MessageHuman msg={msg} .../>;
```

Fallback ke core renderer → replace tanpa jump-through.

**Tool UI** — `MessageTool` sudah receive `msg`. Ubah render body:

```tsx
const Custom = registry.toolUi[msg.toolName];
return Custom ? <Custom msg={msg} args={msg.args} result={msg.result}/>
              : <DefaultToolBubble msg={msg}/>;
```

Butuh extension pada `ChatMessage` type (`chat-types.ts:24-29`) — add optional `toolName?`, `args?`, `result?`. **Schema decision**: tool call messages store structured args/result di dedicated fields, bukan di `content` (yang string). Lihat §6.5 schema migration.

### 6.5 ChatMessage schema migration

`chat-types.ts` saat ini:
```ts
interface ChatMessage {
  id: string;
  role: "human" | "ai" | "tool";
  content: string;
  meta?: MessageMeta;
  branch?: BranchInfo;
}
```

Plugin-aware shape (Phase 3):
```ts
interface ChatMessage {
  id: string;
  role: "human" | "ai" | "tool";
  content: string;          // legacy: human/ai text. Empty string for tool calls.
  meta?: MessageMeta;
  branch?: BranchInfo;
  // Phase 3 additions (all optional, backward-compat)
  toolName?: string;
  args?: unknown;
  result?: unknown;
}
```

Rule: tool role messages MUST populate `toolName` + `args` + (`result` when
completed). Human/ai messages leave new fields undefined. Renderer decision:
`role === "tool"` → use `toolName/args/result` path; else fall back to `content`.

### 6.6 Bundle format

Plugin ship-nya:
- **Dev mode**: `bun` transpile TS ke ESM di plugin dir on-demand, serve via
  `GET /api/plugins/{id}/ui-bundle` (backend melakukan bundling dengan
  `Bun.build`).
- **Prod mode**: plugin author sudah pre-bundle → `ui/index.js` diserve
  as-is dengan `Content-Type: text/javascript`.

React + `@tanstack/react-router` di-**mark external** di plugin bundle. Host
inject via ES module import map (Vite dev + prod).

---

## 7. SDK Package Layout

Monorepo baru di `packages/` (leverage existing bun workspace):

```
packages/
├── sdk-shared/       # types + zod schemas (manifest, ChatMessage, dsb)
├── sdk-frontend/     # PluginModule interfaces + host helpers
├── sdk-backend/      # BackendPlugin, PromptTransformer, host helpers
├── sdk-agent/        # LangGraph glue: withPluginHooks, GraphAnnotation extension
└── cli/              # `puna plugin create|build|publish`
```

Publish ke npm sebagai `@puna/sdk-frontend`, `@puna/sdk-backend`, dst.

CLI commands:

```
puna plugin create my-notes           # scaffold from templates/plugin/*
puna plugin dev                       # watch + hot-reload di workspace .puna/plugins/
puna plugin build                     # bundle prod
puna plugin publish                   # npm publish + puna registry (optional)
```

---

## 8. Security & Permissions

- **Manifest declares** `permissions.fs.read`, `.write`, `.net.hosts`, `.shell`.
- **Enforcement** di backend host: plugin-issued tool calls tunduk ke existing
  sandbox tools (`file-tools`, `http-tools`, `shell-tool`) — reuse `allow`
  arg untuk inject plugin whitelist.
- **UI plugin sandboxing**: React strict boundary + error boundary per slot.
  Tidak sandbox JS execution (in-process ESM). V1 trust model = plugin =
  user-installed = trusted; annotate manifest signature untuk v2.
- **Origin isolation**: bundle diserve dari same-origin backend. Tidak load
  dari CDN eksternal by default.

---

## 9. Frontend ↔ Backend Contract Sync

Karena
[`frontend/src/lib/api/` di-generate dari `/doc`](../frontend/AGENTS.md):

- Semua endpoint `/api/plugins/*` **wajib** di-OpenAPI-kan lewat
  `@hono/zod-openapi` di `route.ts` supaya `bun run openapi:dump` +
  `npm run openapi-ts` menghasilkan client function-nya.
- Manifest schema (`PluginManifest`) di-export via
  `packages/sdk-shared` sekaligus dipakai di route Zod supaya client typed
  end-to-end. Concrete usage di `route.ts`:
  ```ts
  import { PluginManifest } from "@puna/sdk-shared";
  // re-use Zod: route.openapi("...", { body: PluginManifest.openapi() });
  ```
  Single source of truth = sdk-shared; route.ts hanya re-export untuk OpenAPI metadata.

---

## 10. Migration Plan

Bertahap, tiap fase self-contained + shippable:

### Fase 1 — Foundation (1–2 hari)
- [ ] `packages/sdk-shared` + Zod `PluginManifest`
- [ ] `backend/src/modules/plugins/` module (list-only, no load)
- [ ] `.puna/plugins/` layered discovery
- [ ] `/api/plugins` + `/api/plugins/{id}` endpoints

### Fase 2 — Frontend slots (1 hari)
- [ ] `PluginHostProvider` + dynamic import
- [ ] Left bar + footer bar slot integration
- [ ] Sample plugin: sticky notes (left bar + footer counter)

### Fase 3 — Chat + tool UI (1 hari)
- [ ] `chatRenderers` slot di `msg-*`
- [ ] `toolUi` slot di `MessageTool`
- [ ] Extend `ChatMessage` dengan `toolName/args/result`
- [ ] Sample plugin: mermaid tool renderer

### Fase 4 — Backend hooks (2 hari)
- [ ] `PluginHost` singleton
- [ ] `transformSystemPrompt` + wire di `agent-runtime`
- [ ] `extraAgents` + `overrideAgentConf` + merge di `AgentService`
- [ ] `tools` factory + merge di `buildRuntimeTools`

### Fase 5 — Node lifecycle (2 hari)
- [ ] `plugin-bridge.ts` di `agent/`
- [ ] Wrap `callModel` + `callTool` dengan `withPluginHooks`
- [ ] `/api/plugins/hooks` endpoint (HTTP RPC)
- [ ] Sample plugin: logging hook

### Fase 6 — Custom graphs (2 hari)
- [ ] Manifest `graphs[]` support
- [ ] `agent/scripts/link-plugin-graphs.ts`
- [ ] Update `dev.sh` untuk regenerate langgraph.json
- [ ] Sample plugin: research-agent graph

### Fase 7 — SDK + CLI (2–3 hari)
- [ ] Publish `@puna/sdk-*` packages
- [ ] `puna plugin create|dev|build` CLI
- [ ] Template plugin di `templates/plugin/*`
- [ ] Docs di `.docs/plugin-authoring.md`

Total: ~1.5–2 minggu untuk MVP full-stack (single dev).

---

## 11. Non-goals (v1)

- Marketplace / discovery UI (browse remote plugin catalog).
- Cryptographic signature verification.
- Cross-plugin dependency resolution.
- Frontend plugin CSS scoping v1 — plugins share Tailwind utility classes globally. Risk: collision when 2 plugins use same class (Tailwind JIT dedup, bukan class-name smell). Acceptable v1 only if sample plugins stay narrow (≤3 utilities per element). Revisit v2 dengan CSS-modules @ slot boundary.
- Plugin auto-update.

---

## 12. Open Questions

1. **Hot reload**: apakah restart LangGraph server acceptable saat plugin
   di-enable, atau perlu isolate sub-process per plugin graph? → default
   restart; revisit ketika latency terasa.
2. **Global vs local plugin conflicts**: overlay policy sudah jelas (local
   wins). Perlu UI indicator di frontend? → tambah `source: "workspace-local" | "workspace-global" | "system-global"` di
   `PluginSummary` Zod schema (declare §4 alongside `PluginManifest`).
   Tampilkan badge di UI.
3. **Backend hook execution model**: fire-and-forget vs blocking?
   → blocking dengan timeout 5s; kalau plugin lambat, drop hook + log.
4. **Tool namespace collision**: dua plugin daftar tool `search`. Policy?
   → **host prepends** namespace: plugin returns tools dengan bare name (`search`); host renames ke `<pluginId>.search` saat register. Manifest opsional `alias` (`"alias": "search"`) untuk override. **Plugin author tidak tulis prefix** — biar host jadi single source of namespace truth. Update §5.3 contract doc accordingly (add note).

---

## 13. Referensi Kode Eksisting

Reuse yang sudah battle-tested:

- Layered discovery: [`workspace-scanner.ts`](../backend/src/global/workspace-scanner.ts)
- Module pattern: [`backend/AGENTS.md`](../backend/AGENTS.md)
- Agent runtime resolve: [`agent-runtime.ts`](../backend/src/global/agent-runtime.ts)
- Configurable annotation: [`configuration.ts`](../agent/src/base/.libs/configuration.ts)
- Tools factory + filter: [`tools/index.ts`](../agent/src/base/tools/index.ts)
- Left bar contract: [`left-bar.tsx`](../frontend/src/layout/left-bar.tsx) — sudah
  generic (props-driven), tinggal inject via registry.
- Footer bar slots: [`footer-bar.tsx`](../frontend/src/layout/footer-bar.tsx) — already 3-region (left/center/right), inject via §6.3 `<PluginSlot>` wrapper. Refactor minimal.
