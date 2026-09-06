export const config = {
	langgraphUrl: process.env.LANGGRAPH_URL ?? "http://localhost:2024",
	// must match the graph key in agent/langgraph.json ("graph" -> ./src/base/graph.ts:graph)
	graphId: process.env.LANGGRAPH_GRAPH_ID ?? "graph",
	maxConcurrency: {
		default: 3,
	} as Record<string, number>,
};