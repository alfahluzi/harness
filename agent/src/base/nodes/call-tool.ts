import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ensureConfiguration } from "../.libs/configuration.js";
import type { GraphAnnotation } from "../.libs/state.js";
import { buildRuntimeTools } from "../tools/runtime.js";

export async function callTool(
	state: typeof GraphAnnotation.State,
	config: LangGraphRunnableConfig,
) {
	const c = ensureConfiguration(config);
	const tools = await buildRuntimeTools(c);
	const node = new ToolNode(tools, {
		name: "call_tool",
		handleToolErrors: true,
	});
	return node.invoke(state, config);
}
