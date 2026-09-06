// Main graph
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { GraphAnnotation } from "../.libs/state.js";
import { initializeTools } from "../.libs/tools.js";

export async function storeMemory(
	state: typeof GraphAnnotation.State,
	config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
	const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
	const toolCalls = lastMessage.tool_calls || [];

	const tools = initializeTools(config);
	const upsertMemoryTool = tools[0];

	const savedMemories = await Promise.all(
		toolCalls.map(async (tc) => {
			return await upsertMemoryTool.invoke(tc);
		}),
	);

	return { messages: savedMemories };
}
