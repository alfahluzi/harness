import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const BACKEND_MCP_URL = process.env.BACKEND_MCP_URL ?? "http://localhost:3001/mcp";

let client: MultiServerMCPClient | null = null;

async function getClient() {
	if (!client) {
		client = new MultiServerMCPClient({
			sessionManager: {
				transport: "http",
				url: BACKEND_MCP_URL,
			},
		});
	}
	return client;
}

export async function loadSessionManagerTools() {
	const c = await getClient();
	return await c.getTools();
}