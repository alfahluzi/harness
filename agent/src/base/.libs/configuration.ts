import { Annotation, LangGraphRunnableConfig } from "@langchain/langgraph";

const DEFAULT_USER_ID = "default";
const DEFAULT_SYSTEM_PROMPT =
	"You are a helpful assistant with memory. Use the available tools to store memories about the user when they share personal information. Always respond in the same language the user uses.";
const DEFAULT_AGENT_NAME = "main-agent";
const DEFAULT_PROVIDER_NAME = "openrouter";
const DEFAULT_PROVIDER_URL = "https://9router.ljosalfar.cloud/v1";
const DEFAULT_API_KEY = "sk-c4f4e23515e229a5-fijmyr-fc1cda87";
const DEFAULT_MODEL_NAME = "ocg/deepseek-v4-flash";

export const ConfigurationAnnotation = Annotation.Root({
	userId: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_USER_ID,
	}),
	systemPrompt: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_SYSTEM_PROMPT,
	}),
	agentName: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_AGENT_NAME,
	}),
	providerName: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_PROVIDER_NAME,
	}),
	providerUrl: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_PROVIDER_URL,
	}),
	apiKey: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_API_KEY,
	}),
	modelName: Annotation<string>({
		reducer: (_, v) => v,
		default: () => DEFAULT_MODEL_NAME,
	}),
});

export function ensureConfiguration(config: LangGraphRunnableConfig) {
	const c = config.configurable;
	return {
		userId: c?.userId || DEFAULT_USER_ID,
		systemPrompt: c?.system_prompt ?? c?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
		agentName: c?.agent_name ?? c?.agentName ?? DEFAULT_AGENT_NAME,
		providerName: c?.provider_name ?? c?.providerName ?? DEFAULT_PROVIDER_NAME,
		providerUrl: c?.provider_url ?? c?.providerUrl ?? DEFAULT_PROVIDER_URL,
		apiKey: c?.api_key ?? c?.apiKey ?? DEFAULT_API_KEY,
		modelName: c?.model_name ?? c?.modelName ?? DEFAULT_MODEL_NAME,
	};
}
