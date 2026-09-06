import { LangGraphRunnableConfig } from "@langchain/langgraph";

export function getStoreFromConfigOrThrow(config: LangGraphRunnableConfig) {
	const store = config.store;
	if (!store) {
		throw new Error(
			"Store not found in config. Please provide a store in your LangGraph config.",
		);
	}
	return store;
}

export function splitModelAndProvider(model: string) {
	const parts = model.split(":");
	if (parts.length !== 2) {
		throw new Error(
			`Invalid model format: ${model}. Expected format: "provider:model"`,
		);
	}
	return { provider: parts[0], model: parts[1] };
}