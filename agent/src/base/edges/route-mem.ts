// Main graph
import { AIMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { GraphAnnotation } from "../.libs/state.js";

export function routeMessage(
	state: typeof GraphAnnotation.State,
): "call_tool" | typeof END {
	const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
	const toolCalls = lastMessage.tool_calls ?? [];
	return toolCalls.length ? "call_tool" : END;
}
