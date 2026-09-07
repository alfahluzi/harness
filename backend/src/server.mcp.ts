import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionService } from "./modules/sessions/service";
import { CreateSessionInput, TaskIdInput, SendMessageInput } from "./modules/sessions/schema";

const sessionService = new SessionService();

export function buildMcpServer() {
	const server = new McpServer({
		name: "session-manager",
		version: "1.0.0",
	});

	server.registerTool(
		"create_session",
		{
			title: "Create Session",
			description:
				"Spawn a sub-agent session to work on a task. Set background=true to continue " +
				"working while it runs; you'll be notified when it completes. Set background=false " +
				"to wait synchronously for the result. If you are delegating from inside a running " +
				"agent thread, set `parent` to your own calling thread ID so the child can notify " +
				"you when done.",
			inputSchema: CreateSessionInput.shape,
		},
		async (args) => {
			const result = await sessionService.create(args);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"list_sessions",
		{
			title: "List Sessions",
			description:
				"List all known sub-agent tasks with their id, description, status, agentProfile, " +
				"and timestamps. Use to discover running/completed background tasks.",
			inputSchema: z.object({}).shape,
		},
		async () => {
			const result = await sessionService.list();
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"get_session_status",
		{
			title: "Get Session Status",
			description: "Check the status of a background sub-agent task by its task id.",
			inputSchema: TaskIdInput.shape,
		},
		async ({ id }) => {
			const result = await sessionService.getStatus(id);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"get_session_result",
		{
			title: "Get Session Result",
			description: "Retrieve the result of a completed background sub-agent task.",
			inputSchema: TaskIdInput.shape,
		},
		async ({ id }) => {
			const result = await sessionService.getResult(id);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"send_session_message",
		{
			title: "Send Message to Session",
			description:
				"Send a follow-up message to a running or completed sub-agent session, continuing " +
				"the same conversation thread (two-way chat with a sub-agent).",
			inputSchema: SendMessageInput.shape,
		},
		async ({ id, message }) => {
			const result = await sessionService.sendMessage(id, message);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"delete_session",
		{
			title: "Delete Session",
			description: "Cancel a running sub-agent task and delete its session.",
			inputSchema: TaskIdInput.shape,
		},
		async ({ id }) => {
			await sessionService.delete(id);
			return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
		},
	);

	return server;
}
