import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { upsertMemoryTool } from "../tools/upsert-mem.js";

export function initializeTools(config: LangGraphRunnableConfig) {
	return [upsertMemoryTool(config)];
}