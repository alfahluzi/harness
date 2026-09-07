// Main graph
import { END, START, StateGraph } from "@langchain/langgraph";
import { ConfigurationAnnotation } from "./.libs/configuration.js";
import { callModel } from "./nodes/call-llm.js";
import { GraphAnnotation } from "./.libs/state.js";
import { routeMessage } from "./edges/route-mem.js";
import { checkpointer } from "./.libs/checkpointer.js";
import { callTool } from "./nodes/call-tool.js";

// Create the graph + all nodes
export const builder = new StateGraph(GraphAnnotation, ConfigurationAnnotation)
	.addNode("call_model", callModel)
	.addNode("call_tool", callTool)
	.addEdge(START, "call_model")
	.addConditionalEdges("call_model", routeMessage, {
		call_tool: "call_tool",
		[END]: END,
	})
	.addEdge("call_tool", "call_model");

export const graph = builder.compile({ checkpointer });
graph.name = "MemoryAgent";
