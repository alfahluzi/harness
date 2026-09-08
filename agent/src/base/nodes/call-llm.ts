// Main graph
import { BaseMessage } from "@langchain/core/messages";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ensureConfiguration } from "../.libs/configuration.js";
import { GraphAnnotation } from "../.libs/state.js";
import { buildRuntimeTools } from "../tools/runtime.js";
import { getStoreFromConfigOrThrow } from "../.libs/utils.js";
import { ChatOpenAI } from "@langchain/openai";

export async function callModel(
	state: typeof GraphAnnotation.State,
	config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
	const store = getStoreFromConfigOrThrow(config);
	const configurable = ensureConfiguration(config);
	const memories = await store.search(["memories", configurable.userId], {
		limit: 10,
	});

	let formatted =
		memories
			?.map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
			?.join("\n") || "";
	if (formatted) {
		formatted = `\n<memories>\n${formatted}\n</memories>`;
	}

	const sys = configurable.systemPrompt
		.replace("{user_info}", formatted)
		.replace("{time}", new Date().toISOString());

	const llm = new ChatOpenAI({
		model: configurable.modelName,
		temperature: 0.1,
		configuration: {
			baseURL: configurable.providerUrl,
			apiKey: configurable.apiKey,
		},
	});
	const tools = await buildRuntimeTools(configurable);
	const boundLLM = llm.bindTools(tools, {
		tool_choice: "auto",
	});

	const result = await boundLLM.invoke(
		[{ role: "system", content: sys }, ...state.messages],
		{},
	);

	return { messages: [result] };
}
