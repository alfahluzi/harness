// research-agent plugin — "research" graph (Fase 6 / F6-T3).
//
// Registered by `agent/scripts/link-plugin-graphs.ts` as
// `research-agent.research` in `agent/langgraph.json`. The host owns the
// namespace, so this module only exports its compiled graph.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

/** Minimal state for the research pipeline. */
const ResearchState = Annotation.Root({
	query: Annotation<string>(),
	notes: Annotation<string[]>({
		reducer: (current, incoming) => current.concat(incoming),
		default: () => [],
	}),
});

/** Turn the incoming query into a short research plan. */
async function plan(state: typeof ResearchState.State) {
	return { notes: [`plan: investigate "${state.query}"`] };
}

/** Collect notes — real retrieval/tool calls would live here. */
async function collect(state: typeof ResearchState.State) {
	return { notes: [`collected: ${state.query}`] };
}

export const builder = new StateGraph(ResearchState)
	.addNode("plan", plan)
	.addNode("collect", collect)
	.addEdge(START, "plan")
	.addEdge("plan", "collect")
	.addEdge("collect", END);

export const graph = builder.compile();
graph.name = "ResearchAgentResearch";

export default graph;
