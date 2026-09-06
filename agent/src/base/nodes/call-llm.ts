// Main graph
import { BaseMessage } from "@langchain/core/messages";
import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { initChatModel } from "langchain/chat_models/universal";
import { ensureConfiguration } from "../.libs/configuration.js";
import { GraphAnnotation } from "../.libs/state.js";
import { tools } from "../tools/index.js";
import {
	getStoreFromConfigOrThrow,
	splitModelAndProvider,
} from "../.libs/utils.js";
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

	const modelConfig = splitModelAndProvider(configurable.model);
	const llm = new ChatOpenAI({
		model: "ocg/deepseek-v4-flash",
		temperature: 0.1,
		configuration: {
			baseURL: "https://9router.ljosalfar.cloud/v1",
			apiKey: "sk-c4f4e23515e229a5-fijmyr-fc1cda87",
		},
	});
	const boundLLM = llm.bindTools(tools, {
		tool_choice: "auto",
	});

	const result = await boundLLM.invoke(
		[{ role: "system", content: sys }, ...state.messages],
		{},
	);

	return { messages: [result] };
}
