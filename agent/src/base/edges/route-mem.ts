// Main graph
import { AIMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { GraphAnnotation } from "../.libs/state.js";

export function routeMessage(
	state: typeof GraphAnnotation.State,
): "store_memory" | typeof END {
	const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
	if (lastMessage.tool_calls?.length) {
		return "store_memory";
	}
	return END;
}
