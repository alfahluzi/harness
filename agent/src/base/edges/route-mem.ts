// Main graph
import { AIMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { GraphAnnotation } from "../.libs/state.js";

export function routeMessage(
	state: typeof GraphAnnotation.State,
): "store_memory" | "call_tool" | typeof END {
	const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
	const toolCalls = lastMessage.tool_calls ?? [];
	if (!toolCalls.length) {
		return END;
	}
	const allMemory = toolCalls.every((tc) => tc.name === "upsertMemory");
	return allMemory ? "store_memory" : "call_tool";
}
