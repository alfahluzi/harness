// research-agent plugin — "summarize" graph (Fase 6 / F6-T3).
//
// Registered as `research-agent.summary` because the manifest declares
// `alias: "summary"` (key = `<namespace ?? pluginId>.<alias ?? id>`).
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const SummaryState = Annotation.Root({
	notes: Annotation<string[]>({
		reducer: (current, incoming) => current.concat(incoming),
		default: () => [],
	}),
	summary: Annotation<string>(),
});

/** Normalize the incoming notes so the summarize node always has input. */
async function gather(state: typeof SummaryState.State) {
	return { notes: state.notes.length > 0 ? state.notes : ["no notes provided"] };
}

/** Join the notes into a single summary string (LLM call optional). */
async function summarize(state: typeof SummaryState.State) {
	return { summary: state.notes.join("\n") };
}

export const builder = new StateGraph(SummaryState)
	.addNode("gather", gather)
	.addNode("summarize", summarize)
	.addEdge(START, "gather")
	.addEdge("gather", "summarize")
	.addEdge("summarize", END);

export const graph = builder.compile();
graph.name = "ResearchAgentSummary";

export default graph;
