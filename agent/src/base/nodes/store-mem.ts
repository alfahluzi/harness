// Main graph
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { GraphAnnotation } from "../.libs/state.js";
import { upsertMemoryTool } from "../tools/upsert-mem.js";

export async function storeMemory(
	state: typeof GraphAnnotation.State,
	_config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
	const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
	const toolCalls = lastMessage.tool_calls || [];

	const savedMemories = await Promise.all(
		toolCalls.map(async (tc) => {
			const result = await upsertMemoryTool.invoke(tc);
			return typeof result === "string"
				? new (await import("@langchain/core/messages")).ToolMessage({
						content: result,
						tool_call_id: tc.id ?? "",
					})
				: result;
		}),
	);

	return { messages: savedMemories as BaseMessage[] };
}
