// Main graph
import { END, START, StateGraph } from "@langchain/langgraph";
import { ConfigurationAnnotation } from "./.libs/configuration.js";
import { callModel } from "./nodes/call-llm.js";
import { storeMemory } from "./nodes/store-mem.js";
import { GraphAnnotation } from "./.libs/state.js";
import { routeMessage } from "./edges/route-mem.js";

// Create the graph + all nodes
export const builder = new StateGraph(
	GraphAnnotation,
	ConfigurationAnnotation,
)
	.addNode("call_model", callModel)
	.addNode("store_memory", storeMemory)
	.addEdge(START, "call_model")
	.addConditionalEdges("call_model", routeMessage, {
		store_memory: "store_memory",
		[END]: END,
	})
	.addEdge("store_memory", "call_model");

export const graph = builder.compile();
graph.name = "MemoryAgent";
