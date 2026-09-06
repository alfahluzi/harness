import { Annotation, LangGraphRunnableConfig } from "@langchain/langgraph";

const DEFAULT_USER_ID = "default";
const DEFAULT_SYSTEM_PROMPT =
	"You are a helpful assistant with memory. Use the available tools to store memories about the user when they share personal information. Always respond in the same language the user uses.";
const DEFAULT_MODEL = "openai:gpt-4o-mini";

export const ConfigurationAnnotation = Annotation.Root({
	userId: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_USER_ID,
	}),
	systemPrompt: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_SYSTEM_PROMPT,
	}),
	model: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_MODEL,
	}),
});

export function ensureConfiguration(config: LangGraphRunnableConfig) {
	return {
		userId: config.configurable?.userId || DEFAULT_USER_ID,
		systemPrompt: config.configurable?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
		model: config.configurable?.model || DEFAULT_MODEL,
	};
}