import { homedir } from "node:os";
import { join } from "node:path";

function xdgConfigHome(): string {
	return process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.length > 0
		? process.env.XDG_CONFIG_HOME
		: join(homedir(), ".config");
}

export const config = {
	langgraphUrl: process.env.LANGGRAPH_URL ?? "http://localhost:2024",
	// must match the graph key in agent/langgraph.json ("graph" -> ./src/base/graph.ts:graph)
	graphId: process.env.LANGGRAPH_GRAPH_ID ?? "graph",
	maxConcurrency: {
		default: 3,
	} as Record<string, number>,
	// System-wide shared MCP install target. XDG-aware: $XDG_CONFIG_HOME/puna/mcps
	// when set, else ~/.config/puna/mcps. Overridable via PUNA_SYSTEM_MCP_DIR.
	systemMcpDir:
		process.env.PUNA_SYSTEM_MCP_DIR ?? join(xdgConfigHome(), "puna", "mcps"),
	// System-wide shared LLM provider connection target (global connect).
	// XDG-aware: $XDG_CONFIG_HOME/puna/providers, else ~/.config/puna/providers.
	// Overridable via PUNA_SYSTEM_PROVIDERS_DIR.
	systemProvidersDir:
		process.env.PUNA_SYSTEM_PROVIDERS_DIR ??
		join(xdgConfigHome(), "puna", "providers"),
};
