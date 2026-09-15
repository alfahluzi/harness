# Plugin Authoring Guide

Author-facing reference for Puna plugins (v1, Fase 7). A plugin is a directory
with a strict `plugin.json` manifest; it contributes UI slots, backend hooks,
tools, and/or LangGraph subgraphs without forking the harness.

Where the implementation lives:

| Surface | Code |
|---|---|
| Manifest schema (single source of truth) | `packages/sdk-shared/src/manifest.ts` |
| Frontend slot host + loader contract | `packages/sdk-frontend/src/{host,slots}.tsx`, `packages/sdk-frontend/src/{registry,loader}.ts` |
| Backend plugin host / routes | `backend/src/modules/plugins/{host,route,service,loader,contract,permissions}.ts` |
| Agent hook bridge | `agent/src/base/.libs/plugin-bridge.ts` |
| Graph linker | `agent/scripts/link-plugin-graphs.ts` |
| Archetypes | `templates/plugin/{sticky-notes,mermaid-renderer,logging-hook,research-agent}/` |

Where this guide and the code disagree, the code wins.

---

## 1. Quickstart

### Prerequisites

- Repo checkout with the unified bun workspace installed: `bun install` at the repo root.
- Agent dependencies: `(cd agent && npm install)` (the agent keeps its own `node_modules`).
- A workspace: `puna init` creates `.puna/` in the current directory. Plugins are only discovered inside a valid workspace (`configDir` = `<root>/.puna`).
- Backend runs on port `3001` by default (`PORT` overrides it).

### Scaffold

```sh
puna plugin create hello-notes                 # default archetype: sticky-notes
puna plugin create log-it --from logging-hook  # other archetypes: mermaid-renderer | research-agent
```

This copies the archetype to `<dir>/.puna/plugins/<name>/`. Names must be
kebab-case (`^[a-z][a-z0-9-]*$`); the manifest `id` and directory name are both
set to `<name>`. An existing target directory is refused unless `--force` is
passed.

### Run

```sh
./dev.sh          # backend + frontend + agent, Ctrl-C stops all
# or, from a global install: puna serve  (requires .puna/ and the full repo)
```

In a second terminal, while editing the plugin:

```sh
puna plugin dev hello-notes --backend http://localhost:3001
```

`dev` watches the plugin directory, re-validates `plugin.json`, and warms
`GET /api/plugins/<id>/ui-bundle`. The backend re-bundles changed UI sources on
the next request (mtime/size revalidation), so no backend restart is needed for
UI edits.

### Verify

```sh
curl "http://localhost:3001/api/plugins?configDir=$PWD/.puna"
curl "http://localhost:3001/api/plugins/hello-notes?configDir=$PWD/.puna"
curl -i "http://localhost:3001/api/plugins/hello-notes/ui-bundle?configDir=$PWD/.puna"
```

The second call returns `{ manifest, source, resolvedDir }`; the third returns
ESM JavaScript with `X-Plugin-Bundle-Cached: 0` on a fresh build and `: 1` when
the cached stamp still matches.

### See it in the app

The frontend fetches `GET /api/plugins?configDir=<active>` and then one
`GET /api/plugins/<id>?configDir=<active>` per plugin to read `capabilities`.
UI modules are rendered through a host-supplied `Loaders` map keyed
`<pluginId>::<capabilityKey>::<exportName>`; in this repo that map is static
(`frontend/src/lib/plugins/loader.ts`) and currently wires only the archetype ids
`sticky-notes` and `mermaid-renderer`. So:

- `puna plugin create sticky-notes` (or `mermaid-renderer`) renders in the app immediately — the loader key already matches.
- A plugin with any other id is listed by the API but its UI stays hidden until the host adds a loader entry for it (or the host starts consuming `GET /api/plugins/<id>/ui-bundle`). Backend hooks, tools, and graphs are not affected by this UI wiring limitation.
- The plugin list is fetched when `configDir` changes; reload the app after scaffold/remove to refresh the registry.

### Iterate

| Change | Picked up by |
|---|---|
| UI source (`.ts`/`.tsx`) | Next `ui-bundle` request (mtime revalidation) — or `puna plugin dev` warming |
| Manifest capabilities (UI) | Next `ui-bundle` request / app reload |
| Backend hooks / tools | Backend restart (the backend host is cached per `configDir` for the process lifetime) |
| Graph declarations | Agent restart (`dev.sh` re-runs the graph linker before every agent start) |

---

## 2. Plugin anatomy

### Directory layout

```
hello-notes/
├── plugin.json        # required: strict manifest, directory marker
├── ui/                # optional: leftBar / footerBar / chatRenderers / toolUi entries
│   └── index.tsx
├── backend/           # optional: backendHooks / tools entries
│   └── index.ts
├── graphs/            # optional: LangGraph subgraph modules
│   └── my-graph.ts
└── README.md          # optional
```

Only files referenced by `capabilities` must exist. Every `entry` is a
workspace-relative path from the plugin root and is validated as a safe relative
path (no leading `/`, `\`, drive letter, `..` segment, or NUL byte). Plugin
identity is the manifest `id`, not the directory name.

### Discovery layers

Scanned in this order, later layers overriding earlier ones **on directory-name
collision** (`mergeLayered3`):

| Layer | Path | Reported `source` |
|---|---|---|
| system-global | `~/.config/puna/plugins/<dir>/` | `system-global` |
| workspace-global | `<globalConfigDir>/plugins/<dir>/` (`globalConfigDir` from `<configDir>/config.json`) | `workspace-global` |
| workspace-local | `<root>/.puna/plugins/<dir>/` | `workspace-local` |

`GET /api/plugins/<id>` iterates the merged entries and returns the first
manifest whose `id` matches. `PluginSummary.kind` is derived: `graphs` + UI →
`mixed`, `graphs` only → `graph`, `backendHooks` without UI → `agent-hook`,
otherwise `ui` (also the default when `capabilities` is absent).

### `plugin.json` field reference

The schema is a Zod **strict object**: unknown keys anywhere (manifest,
capabilities, permissions, graph entries, shell entries) are rejected with
`Unrecognized key: "<name>"`. Fields:

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `$schema` | string | no | — | Documentation pointer only, e.g. `https://puna.dev/schemas/plugin.v1.json`; not fetched or validated. |
| `id` | string | yes | — | Non-empty. Plugin identity used by `GET /api/plugins/<id>`. The schema has no format constraint; the CLI enforces kebab-case for `create`. |
| `name` | string | yes | — | Non-empty display name. |
| `version` | string | yes | — | Semver 2.0.0 (official regex). |
| `description` | string | yes | — | May be an empty string. |
| `author` | string | no | — | — |
| `license` | string | no | — | — |
| `engines.puna` | string | yes | — | Non-empty. Recorded only; v1 does **not** check it against the running harness version. |
| `capabilities` | object | no | — | Strict object, see below. |
| `permissions` | object | no | — | Strict object, see §4. |

Capability keys — all optional, all strict:

| Key | Shape | Meaning |
|---|---|---|
| `leftBar` | `{ entry, export? }` | Component docked in the left navigation panel. |
| `footerBar` | `{ entry, export? }` | Component rendered in the footer (v1: right region only). |
| `chatRenderers` | `{ entry, export? }` | Per-role chat message render overrides. |
| `toolUi` | `{ entry, export? }` | Tool-name → inline component map. |
| `backendHooks` | `{ entry, export? }` | Default export = `BackendPlugin` object/factory (hooks, prompt/agent overlays, optional `tools`). |
| `tools` | `{ entry, export? }` | Tool factory. If `export` is present it must be the literal `"default.tools"`. |
| `graphs` | array of graph entries | LangGraph subgraph declarations. |

`CapabilityEntry.export` is a non-empty named export; when omitted the loader
resolves the module's `default` export. Graph entry fields:

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | — | Bare graph id, kebab-case (`^[a-z][a-z0-9-]*$`). |
| `entry` | string | yes | — | Plugin-relative module path. |
| `export` | string | no | `"graph"` | Named export to load. |
| `alias` | string | no | — | Overrides the un-namespaced graph name (`alias ?? id`). |
| `namespace` | string | no | plugin `id` | Overrides the namespace. Authors should normally leave this out; the host owns the prefix. |

### Annotated example

`comments are for reading only — plugin.json must be valid JSON`

```jsonc
{
  "$schema": "https://puna.dev/schemas/plugin.v1.json",
  "id": "sticky-notes",              // required; also the API :id
  "name": "Sticky Notes",            // required; shown in the dock/panel header
  "version": "0.1.0",                // required; semver 2.0.0
  "description": "Persistent sticky notes anchored in the left bar; counter widget in the footer.",
  "author": "Puna",                  // optional
  "license": "MIT",                  // optional
  "engines": { "puna": ">=0.1.0" },  // required (content not enforced in v1)
  "capabilities": {
    "leftBar":   { "entry": "./ui/index.tsx", "export": "StickyNotesEntry" },
    "footerBar": { "entry": "./ui/index.tsx", "export": "StickyNotesCounter" }
  },
  "permissions": { "fs": { "write": [".puna/notes/"] } }
}
```

Both `./ui/index.tsx` and `ui/index.tsx` are accepted (`./` is tolerated by the
path guard); `./` prefixes and trailing `/` are also normalized when matching
permission paths.

---

## 3. Capabilities

### `leftBar`

Export a React component (named via `export`, or the `default` export). The host
renders it in a dock panel and passes `{ pluginId, configDir }` props.

```tsx
// ui/index.tsx
export function NotesPanel() {
  return <div className="p-3 text-sm">Plugins share the app's Tailwind utilities.</div>;
}
export default NotesPanel;
```

```json
"capabilities": { "leftBar": { "entry": "ui/index.tsx", "export": "NotesPanel" } }
```

Archetype: `sticky-notes` (`StickyNotesEntry`).

### `footerBar`

Same component contract as `leftBar`. v1 limitation: the manifest has no region
field, so contributions always land in the **right** footer region
(`DEFAULT_FOOTER_REGION = "right"`); `usePluginFooterBarItems("left"|"middle")`
returns nothing. Keep the widget small — it sits in an `h-8` bar.

```tsx
export function NoteCount() {
  return <span className="mx-2">Notes: 3</span>;
}
```

```json
"footerBar": { "entry": "ui/index.tsx", "export": "NoteCount" }
```

Archetype: `sticky-notes` (`StickyNotesCounter`).

### `chatRenderers`

The named export (or `default`) is an object:

```ts
type ChatRendererContribution = {
  human?: (msg: ChatMessage) => ReactNode | undefined;
  ai?: (msg: ChatMessage, opts: { streaming?: boolean }) => ReactNode | undefined;
  tool?: (msg: ChatMessage) => ReactNode | undefined;
};
```

A renderer returning `undefined` means "no opinion" and the core bubble is used.
Precedence: the first plugin in registry order declaring `chatRenderers` wins;
if its renderer for a role returns `undefined`, the core renderer is used — a
lower-priority plugin is not consulted. The `msg` shape is `ChatMessage`
(`id?`, `role: "human" | "ai" | "tool"`, `content`, plus optional `model`,
`ts`, `toolName`, `args`, `result`).

```tsx
// ui/index.tsx
import type { ChatMessage, ChatRendererContribution } from "@puna/sdk-frontend";

export const chatRenderers: ChatRendererContribution = {
  ai(msg: ChatMessage, { streaming }) {
    if (streaming) return undefined; // fall back to the core bubble while streaming
    return <div className="rounded bg-indigo-50 p-2">{msg.content}</div>;
  },
};
```

```json
"chatRenderers": { "entry": "ui/index.tsx", "export": "chatRenderers" }
```

Archetype: none. (`mermaid-renderer` shows the same object-on-named-export
pattern for `toolUi`.)

### `toolUi`

The named export (or `default`) is an object keyed by tool name. Each value is a
component receiving `{ msg, args?, result? }`. The first plugin exporting a
component for `msg.toolName` wins; legacy tool messages without `toolName` keep
the default bubble.

```tsx
// ui/index.tsx
import type { ToolUiComponentProps } from "@puna/sdk-frontend";

function Mermaid({ msg, args, result }: ToolUiComponentProps) {
  const source = (args as { source?: string } | undefined)?.source ?? "";
  return <pre>{source || msg.content}</pre>;
}

export const toolUi = { mermaid: Mermaid };
```

```json
"toolUi": { "entry": "ui/index.tsx", "export": "toolUi" }
```

Archetype: `mermaid-renderer` (`toolUi.mermaid`).

### `backendHooks`

Dynamic-imported and executed in the **backend** process. The export (default
unless `export` is set) is either a `BackendPlugin` object or a factory that
returns one:

```ts
interface BackendPlugin {
  id: string;
  transformSystemPrompt?: (ctx: PromptContext, prompt: string) => string | Promise<string>;
  beforeNode?: (nodeName: string, state: unknown, cfg: unknown) => Promise<void>;
  afterNode?: (nodeName: string, state: unknown, cfg: unknown) => Promise<Record<string, unknown> | void>;
  extraAgents?: () => Promise<AgentSummary[]>;
  overrideAgentConf?: (agentName: string, conf: AgentConf) => AgentConf;
  tools?: (config: ToolsConfig) => StructuredTool[];
}
```

`PromptContext` is `{ agentName, workspaceId, configDir }`.
`transformSystemPrompt` transformers run in plugin-id order; a throwing
transformer is logged and skipped, and the pipeline continues with the prompt as
of that step. `overrideAgentConf` is piped per plugin; a throw keeps the current
value. Node hooks are covered in §5, `tools` in the next subsection.

```ts
// backend/index.ts
const PREFIX = "[plugin:hello-notes]";

async function beforeNode(nodeName: string, state: unknown, _cfg: unknown) {
  console.log(`${PREFIX} -> before ${nodeName}`, state);
}

async function afterNode(nodeName: string, _state: unknown, _cfg: unknown) {
  console.log(`${PREFIX} <- after ${nodeName}`);
  // Returning a plain object here would be merged into the graph state.
}

export default { id: "hello-notes", beforeNode, afterNode };
```

Manifest (`export` omitted → `default`; the archetype follows the same
object-with-named-functions pattern — a bare named export is only reachable when
you also set `export`):

```json
"backendHooks": { "entry": "backend/index.ts" }
```

Archetype: `logging-hook` (logs both phases, returns no patch).

### `tools`

Two supported shapes:

1. **Object form** — default-export a `BackendPlugin` with a `tools(config)` method:

```ts
type StructuredTool = {
  name: string;
  description?: string;
  schema?: unknown;
  invoke: (input: unknown) => Promise<unknown> | unknown;
};

export default {
  id: "hello-notes",
  tools(_config: { configDir: string; workspaceId: string }): StructuredTool[] {
    return [{
      name: "word_count",
      description: "Count words in a string",
      invoke: (input) => String((input as { text?: string }).text ?? "").split(/\s+/).filter(Boolean).length,
    }];
  },
};
```

```json
"tools": { "entry": "backend/index.ts" }
```

2. **Bare factory form** — default-export an object whose `tools` property is the
   factory function, and point the manifest at it:

```ts
export default {
  tools(_config: { configDir: string; workspaceId: string }): StructuredTool[] {
    return [/* … */];
  },
};
```

```json
"tools": { "entry": "backend/index.ts", "export": "default.tools" }
```

`"default.tools"` is the only non-empty value the strict schema accepts for
`tools.export`; a bare tool factory reached without it is treated as a
`BackendPlugin` object and contributes nothing.

Host behavior: the factory is called with
`{ configDir: <plugin resolved dir>, workspaceId: <plugin id> }` (yes, the
`workspaceId` value is the plugin id). Returned tools are re-namespaced as
`<pluginId>.<toolName>` (host is the single source of namespace truth);
malformed entries (missing string `name` or non-function `invoke`) are skipped
with a warning. `PluginHost.writeToolDescriptors()` serializes name +
description + schema (no implementation) to `.runtime/plugin-tools.json` for the
agent sub-process.

Archetype: none. Declaring `capabilities.tools` is also what makes
`PluginHost.discoverAndLoad` import the backend module; a plugin with only
`backendHooks` uses the same loader.

### `graphs`

Each array entry declares one LangGraph subgraph. The export must be a compiled
runnable (`builder.compile()`). Graphs do not require a backend module.

```ts
// graphs/my-graph.ts
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const State = Annotation.Root({ query: Annotation<string>() });

export const graph = new StateGraph(State)
  .addNode("plan", async (s) => ({ ...s }))
  .addEdge(START, "plan")
  .addEdge("plan", END)
  .compile();

export default graph;
```

```json
"graphs": [
  { "id": "my-graph", "entry": "graphs/my-graph.ts", "export": "graph" },
  { "id": "summarize", "entry": "graphs/summarize.ts", "alias": "summary" }
]
```

Archetype: `research-agent` (graphs `research` and `summarize` with
`alias: "summary"`). See §6 for registration and namespacing.

### Slot error isolation

Every plugin render surface is wrapped in `PluginErrorBoundary`: a component
that throws is caught, logged as
`[puna:plugins] slot "<pluginId>:<capabilityName>" crashed`, and renders
`fallback ?? null` — it never crashes the app. A loader that fails to resolve
logs `[puna:plugins] loader "<pluginId>::<capability>::<export>" failed` and
that slot stays empty. Design for this: a bad plugin degrades to nothing, not to
a white screen.

---

## 4. Permissions

`permissions` is declarative metadata plus an enforcement mechanism. All four
kinds are optional; an empty object is valid.

```json
{
  "permissions": {
    "fs": { "read": ["notes/", ".puna/data"], "write": [".puna/notes/"] },
    "net": { "hosts": ["api.openai.com"] },
    "shell": [{ "command": "git", "args": ["status"] }]
  }
}
```

| Kind | Declared as | Match rule (enforcement) |
|---|---|---|
| `fs.read` | array of safe relative paths | **Exact or prefix**: target equals the pattern, or starts with `<pattern>/`. Leading `./` and trailing `/` are normalized on both sides before comparing. |
| `fs.write` | array of safe relative paths | Same exact-or-prefix rule as `fs.read`. |
| `net` | `{ hosts: string[] }` | **Exact hostname** (`allowed.includes(target)`); no wildcard/subdomain matching. |
| `shell` | `{ command, args? }[]` | **Exact command** (`entry.command === target`); `args` are recorded but not part of the match. |

Patterns are `safeRelativePath` values (no leading `/`, no `..`, no NUL byte).

### v1 trust model

Plugins are user-installed and therefore **trusted**. There is no sandbox and no
runtime permission prompt:

- `PluginHost.getTools()` applies **no** permission checks.
- `PluginHost.enforceTools()` is the opt-in integration point: it returns the
  same namespaced tools with a bound `verify(action, target)` that consults the
  enforcer and throws `PermissionDeniedError` (`Plugin "<id>" not permitted:
  <action> on "<target>"`).
- `PluginHost.checkPermission(pluginId, action, target)` is the direct probe.
- UI plugins run as in-process ESM with full access to the page (same origin);
  permissions do not constrain UI code.

Declare the permissions your plugin actually needs: they are the contract
against which host integrations can enforce, and they document intent.

---

## 5. Node lifecycle hooks

Hooks run in the **backend** process; the agent sub-process cannot serialize
functions, so it reports lifecycle events over HTTP and the backend executes the
hooks (fail-open).

### Descriptor discovery

```
GET /api/plugins/hooks?configDir=<path>
→ { "configDir": "...", "timeoutMs": 5000,
    "plugins": [{ "id": "logging-hook", "beforeNode": true, "afterNode": true }] }
```

Only loaded plugins declaring at least one hook appear. The agent caches the
response per `${backendUrl}|${configDir}` for the process lifetime and posts
nothing when no plugin declares hooks (`withPluginHooks` is then a pass-through).
`workspace` is accepted as an alias for `configDir` on this route.

### Run

```
POST /api/plugins/hooks?configDir=<path>
{ "phase": "beforeNode" | "afterNode", "node": "<node name>", "state": { ... }, "config": { ... } }
→ { "patch": { ... } | null, "invoked": 1, "dropped": 0 }
```

- `config` is the agent's `config.configurable` object.
- `state` for `afterNode` is `{ ...incomingState, ...nodeOutput }`.
- Hook signature: `(nodeName, state, cfg)`.

### Patch semantics

- `beforeNode` return values are **ignored**; a hook that returns an object still
  contributes no patch.
- `afterNode` results merge with **spread**, never mutation:
  `patch = { ...patch, ...result }` across plugins in plugin-id order (a later
  plugin wins on key collision). The agent then applies
  `{ ...nodeOutput, ...patch }`.
- Returning `void`/`null`/a non-object contributes nothing.

### Timeout and failures

- Each hook is individually raced against `timeoutMs` (the route advertises
  `5000`; the bridge default is `DEFAULT_HOOK_TIMEOUT_MS = 5000`).
- A hook that throws or exceeds the timeout is counted in `dropped`, logged as
  `[plugins] <id>: <phase> hook failed: hook timed out after 5000ms`, and the
  graph continues.
- Transport failures are fail-open on the agent side: failed discovery or POSTs
  warn (`[plugins] ...`) and pass through to the node implementation.
- The hook cache means adding/removing hook plugins requires an agent process
  restart to re-discover descriptors.

---

## 6. Custom graphs

Graph declarations live in `capabilities.graphs[]` (§3) and are registered into
the LangGraph dev server by `agent/scripts/link-plugin-graphs.ts`. No backend
module is involved, and `dev.sh` re-runs the linker before every agent restart.

The linker:

1. Scans `plugin.json` manifests across the three plugin layers (workspace-local
   → workspace-global → system-global; local wins on directory-name collision) —
   no backend HTTP call.
2. Symlinks `agent/.plugins/<pluginId>` → the plugin directory, so graph modules
   keep resolving their own relative imports. Stale links are removed.
3. Rewrites `agent/langgraph.json` with the base graph plus one entry per
   declared graph:

```json
{
  "graphs": {
    "graph": "./src/base/graph.ts:graph",
    "research-agent.research": "./.plugins/research-agent/graphs/research.ts:graph",
    "research-agent.summary": "./.plugins/research-agent/graphs/summarize.ts:graph"
  },
  "env": ".env"
}
```

### Namespacing

The **host owns the prefix**: authors write the bare `id` (plus optional
`alias`), and the registration key is
`<namespace ?? pluginId>.<alias ?? id>` (`resolveGraphKey`). Never write the
prefix yourself — it is prepended for you, and the same policy is used by the
agent-side linker and the backend `PluginHost.getGraphs()` descriptors.

### Constraints

- A declared graph whose `entry` file does not exist is skipped with a warning;
  if none of a plugin's declared graphs is usable, its directory is not
  symlinked in that run.
- Duplicate registration keys warn and the first (lowest key) wins.
- Graph modules are loaded by the agent process; bare imports resolve from the
  plugin directory upward, so the plugin needs its own `node_modules` or a
  parent that provides the packages (`@langchain/langgraph`, etc.).
- The linker is idempotent: a second run writes byte-identical output. A
  workspace with zero graph plugins is a success.
- Manifest edits are picked up when the agent restarts (linker runs per start);
  no backend or frontend restart is needed for graph registration.

---

## 7. UI bundles: dev vs prod

The backend serves one ESM module per plugin at:

```
GET /api/plugins/<id>/ui-bundle?configDir=<path>
Content-Type: text/javascript; charset=utf-8
```

### Which entry is served

The route picks a single UI capability per plugin in this order:
`chatRenderers` → `toolUi` → `leftBar` → `footerBar`. If a plugin declares
several UI capabilities, only the **first** declared in that order is bundled
and served — point all UI capabilities at the same entry (as `sticky-notes`
does) if you need them all available.

### Build rule

| Entry extension | Behavior |
|---|---|
| `.ts`, `.tsx` | Built on demand with `Bun.build({ target: "browser", format: "esm", minify: false, sourcemap: "none" })`. |
| `.js`, `.mjs` | Served as-is (prod/pre-bundled mode). |
| anything else | `500` — `ui bundle build failed: unsupported entry extension: <path>`. |

Both dev builds and pre-bundled files keep these as **bare externals** — the
host provides them, so React is never duplicated in a plugin bundle:

```
react, react-dom, react/jsx-runtime, react-dom/client, @tanstack/react-router
```

### Caching / hot reload

Each cached bundle stores the entry file's `mtimeMs` and byte `size`. Every
request stats the entry: a matching stamp serves the cached bundle with
`X-Plugin-Bundle-Cached: 1`; a changed (or unreadable) entry drops the cache and
rebuilds, answering `: 0`. This is what makes `puna plugin dev` hot-reload UI
edits without a backend restart. Cache entries are never proactively evicted;
they are overwritten in place.

### When to pre-bundle

Ship pre-bundled ESM when you want deterministic, reviewed artifacts instead of
on-demand builds. `puna plugin build` emits a minified ESM bundle next to each
UI capability entry (`ui/index.tsx` → `ui/index.js`) with React/router external,
prints raw + gzip size, and fails when the gzip size exceeds the production
budget of **50 KB** (configurable with `--budget-kb <n>`). Point the manifest
`entry` at the emitted `.js` (or let `--update-manifest` rewrite it). The
50 KB gzip budget matches the Fase 7 acceptance gate for sample bundles.

### Build failure responses

| Response | Cause |
|---|---|
| `500 ui bundle build failed: plugin declares no UI capability` | None of the four UI keys is declared. |
| `500 ui bundle entry not found: <entry>` | The entry path does not resolve to a file. |
| `500 ui bundle build failed: <logs>` | `Bun.build` failed; the log messages are joined into the error. |
| `500 ui bundle build failed: unsupported entry extension: <entry>` | Entry is not `.ts/.tsx/.js/.mjs`. |
| `404 Plugin not found: <id>` | No manifest with that `id` in the workspace's layers. |

---

## 8. CLI reference

```
puna plugin create <name> [--from <archetype>] [--dir <dir>] [--force]
puna plugin dev  [<name>] [--dir <dir>] [--backend <url>] [--no-warm]
puna plugin build [<name>] [--dir <dir>] [--minify] [--update-manifest] [--budget-kb <n>]
```

`--from` archetypes: `sticky-notes` (default) | `mermaid-renderer` |
`logging-hook` | `research-agent`.

### `create`

- Copies `templates/plugin/<archetype>/` to `<dir>/.puna/plugins/<name>/`.
- `<name>` must be kebab-case (`^[a-z][a-z0-9-]*$`); the manifest `id` and
  directory name are both set to it, and `name` is rewritten to Title Case.
  Other archetype fields (`$schema`, `version`, `engines`, capabilities,
  permissions, author metadata) are preserved.
- Refuses to overwrite an existing target without `--force`; a failed run
  removes the half-scaffolded directory.
- `--dir <dir>`: workspace root; a `.puna` directory is resolved to its parent.
  Default: walk up from cwd to the first ancestor containing `.puna/config.json`,
  falling back to cwd.
- The generated manifest is strict-validated before success is reported.

### `dev`

- Watches `<dir>/.puna/plugins/` recursively (or one plugin when `<name>` is
  given); `node_modules` and `.git` are ignored; changes are debounced (~150 ms).
- Re-validates `plugin.json` on change and warms the backend:
  `GET /api/plugins/<id>?configDir=...` followed by
  `GET /api/plugins/<id>/ui-bundle?configDir=...` for every declared UI
  capability, so manifest and bundling errors surface in the terminal.
- The backend re-bundles changed UI on the next request (mtime/size
  revalidation), so no backend restart is needed for UI edits.
- `--no-warm`: only report changed files; no HTTP calls.
- `--backend <url>`: backend base URL; default `http://localhost:<PORT ?? 3001>`
  (`PUNA_BACKEND_URL`, `PUNA_BACKEND_PORT`, or `PORT` also read). A backend that
  is down is a warning, never a crash; the watcher keeps running until SIGINT
  (exit 0).

### `build`

- Emits a minified ESM bundle next to each UI capability entry
  (`ui/index.tsx` → `ui/index.js`) with React/router left external.
- Prints raw + gzip size per bundle; fails when gzip exceeds the budget
  (default 50 KB, override `--budget-kb <n>`).
- `--minify`: minify emitted bundles.
- `--update-manifest`: rewrite the manifest capability `entry` to the built
  `.js` file.

Exit codes for all three commands: `0` success, `1` runtime failure (invalid
manifest, missing dir, build failure), `2` invalid invocation (unknown flag, bad
name/archetype).

---

## 9. Publishing the SDK packages

Packages live in `packages/` and share the root bun workspace:

| Package | Contents |
|---|---|
| `@puna/sdk-shared` | Manifest Zod schema + types, source-layer enum, graph naming policy. |
| `@puna/sdk-frontend` | `PluginHostProvider`, slot helpers, registry client, loader contract, badge. |
| `@puna/sdk-backend` | Version constant only (see below). |
| `@puna/sdk-agent` | Hook contract types only (see below). |

### Build and publish flow

- Development needs **no build**: package `exports` resolve `./src/*.ts`, and
  the workspace toolchain (Bun, Vite) reads TypeScript directly.
- `bun run build` in a package emits `dist/` JavaScript plus `.d.ts`
  declarations; the package also wires `prepublishOnly` to run the build before
  publishing. `main`, `module`, and `types` point at `dist/`; `files` ships both
  `src/` and `dist/`.
- `bun link` (or a workspace dependency) is the local-consumption path; `npm
  publish` is for a real registry.
- Note for external consumers: the `exports` map still targets `src/*.ts` as of
  this revision. Inside the workspace and with `bun link` that is intended;
  verify the published package resolves the built output for your runtime
  before relying on it.

### Honest state of the SDK

- `@puna/sdk-shared` and `@puna/sdk-frontend` are the implemented runtime
  surfaces.
- `@puna/sdk-backend` currently ships the version constant **only**. The real
  backend host/loader/service/permissions logic lives in the harness at
  `backend/src/modules/plugins/` and is not (yet) a published runtime surface.
- `@puna/sdk-agent` currently ships the lifecycle hook **contract types**. The
  runtime bridge lives in `agent/src/base/.libs/plugin-bridge.ts`.
- Consequence for authors: backend modules are written against the structural
  shapes in §3 (as the archetypes do) rather than importing runtime helpers from
  `@puna/sdk-backend` / `@puna/sdk-agent`.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `invalid plugin.json (...): <root>: Unrecognized key: "foo"` | Strict schema. Any unknown key in the manifest, `capabilities`, `permissions`, a graph entry, or a shell entry is rejected. Remove it (or fix the spelling). |
| `...: entry: path must be relative (no leading '/', '\', or drive letter)` / `path must not contain '..' segments` / `path must not contain a NUL byte` | Every `entry` is validated by `safeRelativePath`. Use plugin-relative paths. |
| `500 ui bundle build failed: plugin declares no UI capability` | `/ui-bundle` requires at least one of `chatRenderers`, `toolUi`, `leftBar`, `footerBar`. |
| `500 ui bundle entry not found: <entry>` | The declared path does not exist relative to the plugin root; `entry` is case- and extension-sensitive. |
| `500 ui bundle build failed: <logs>` | The on-demand `Bun.build` failed; the response joins the build logs. Reproduce with the same file via `puna plugin dev` to see it in the terminal. |
| Plugin renders nothing after a throw | Working as designed: the slot's `PluginErrorBoundary` logged `[puna:plugins] slot "<id>:<capability>" crashed` and rendered null. Check the browser console. |
| `[puna:plugins] loader "<id>::<cap>::<export>" failed` | Loader rejection (bad module, missing export). Check the exact loader key: `<pluginId>::<capabilityKey>::<exportName>` (empty string for a default export). |
| Hook silently does nothing | Hook not discovered (`GET /api/plugins/hooks` returned none for the workspace), the descriptor cache was populated before the plugin was added (restart the agent), or the phase returns no patch (`beforeNode` results are ignored). |
| Hook dropped after 5s | Per-hook timeout (`hook timed out after 5000ms`); the hook is counted in `dropped` and the graph continues. Keep hooks fast or make them fire-and-forget. |
| `[plugins] <phase> hook ... failed: HTTP ...` / `hook discovery failed` | Agent-side fail-open warnings: backend was unreachable or returned an error; graph proceeds without hooks. |
| `puna plugin dev` says `backend unreachable ... — still watching` | Point `--backend` at the running backend (default `http://localhost:3001`), or set `PUNA_BACKEND_URL`/`PORT`. |
| Plugin listed but UI not visible in the app | The host's static `Loaders` map (`frontend/src/lib/plugins/loader.ts`) has no entry for that plugin id; only `sticky-notes`/`mermaid-renderer` are wired. Backend hooks/tools/graphs still work. |
| Plugin missing from `GET /api/plugins` | Invalid manifest → the list degrades to a minimal summary (directory name as `id`, version `0.0.0`) and logs `[plugins] invalid manifest at <dir>` to the backend stdout. Also check layer collisions: the same directory name in a higher layer wins. |
| Backend hooks/tools edits ignored until restart | `getPluginHostForWorkspace` caches one host per `configDir` for the process lifetime; restart the backend. |
| Graph not registered | Declared `entry` file must exist (linker skips + warns otherwise); duplicate keys keep the first; restart the agent to re-run the linker. Check `agent/langgraph.json`. |
| `plugin templates not found` from `create` | Run from the repo checkout (templates live at `templates/plugin/`) or set `PUNA_PLUGIN_TEMPLATES_DIR`. |

---

## 11. Out of scope for v1

Mirrors `docs/plans/plugin-sdk/plan.md`:

- Marketplace / discovery UI.
- Cryptographic signature verification.
- Cross-plugin dependency resolution.
- CSS scoping v2 — plugins share the host's Tailwind utility globals; CSS modules
  at the slot boundary are deferred.
- Plugin auto-update.

Additional known v1 limitations called out in this guide:

- `engines.puna` is recorded but not enforced against the running harness.
- `footerBar` contributions always render in the right region.
- `/ui-bundle` serves a single UI entry per plugin (preference order in §7).
- Permissions are declarative/opt-in (§4); UI plugins run unsandboxed.
- Hook descriptor discovery is cached per agent process; hook-plugin changes
  need an agent restart.
- The host app's static UI loader map only wires the sample archetype ids.
