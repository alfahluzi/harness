# research-agent — custom graph plugin template

Sample plugin (Fase 6 / F6-T3) that contributes **two** LangGraph subgraphs to
the host through `capabilities.graphs[]`. Copy the folder into
`<workspace>/.puna/plugins/research-agent/` to activate it. A `graph`-kind
plugin needs no backend module, so this template has no `backend/` directory.

## `capabilities.graphs[]`

Each entry declares one graph:

| field       | required | meaning                                                   |
|-------------|----------|-----------------------------------------------------------|
| `id`        | yes      | bare graph id (kebab-case)                                |
| `entry`     | yes      | relative path to the module, from the plugin root         |
| `export`    | no       | named export to load (default: `"graph"`)                 |
| `alias`     | no       | overrides the un-namespaced name (`alias ?? id`)          |
| `namespace` | no       | overrides the namespace (`namespace ?? pluginId`)         |

The **host owns the namespace**: authors write bare ids, and the registration
key becomes `<namespace ?? pluginId>.<alias ?? id>`. This template registers
`research-agent.research` and — via `alias: "summary"` —
`research-agent.summary`. The `export` must be a compiled LangGraph runnable
(`builder.compile()`), and the module should also `export default` it.

## How registration works

`dev.sh` runs `agent/scripts/link-plugin-graphs.ts` before every start of the
LangGraph server (the `agent` leg of `run_one`, i.e. on every restart). The
linker:

1. scans `plugin.json` manifests across the three plugin layers
   (workspace-local → workspace-global → system-global, local wins on
   directory-name collision) — no backend API needed,
2. symlinks `agent/.plugins/<pluginId>` → your plugin directory,
3. rewrites `agent/langgraph.json` with one graph entry per declaration, e.g.

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

Declared graphs whose `entry` file does not exist are skipped with a warning.
Restarting the agent re-runs the linker, so manifest edits are picked up
without restarting backend/frontend.

## Dependency resolution

Graph modules are loaded by the **agent process**, and Node/esbuild resolve
symlinks to their real paths. Bare imports (`@langchain/langgraph`, …) are
therefore resolved from your plugin directory upward: make sure the plugin has
its own `node_modules`, or lives under a parent directory that provides the
needed packages.
