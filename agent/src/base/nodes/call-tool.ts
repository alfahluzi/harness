import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tools } from "../tools/index.js";

export const callTool = new ToolNode(tools, {
	name: "call_tool",
	handleToolErrors: true,
});
