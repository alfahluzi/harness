import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionService } from "./modules/sessions/service";
import {
	CreateSessionInput,
	SessionIdInput,
	SendMessageInput,
} from "./modules/sessions/schema";
import { AgentService } from "./modules/agents/service";
import { SkillService } from "./modules/skills/service";
import { McpService } from "./modules/mcps/service";
import { RegistryClient } from "./modules/mcps/registry";

const sessionService = new SessionService();
const agentService = new AgentService();
const skillService = new SkillService();
const mcpService = new McpService();
const mcpRegistry = new RegistryClient();

const ConfigDirInput = z.object({ configDir: z.string().min(1) });
const AgentLookupInput = ConfigDirInput.extend({
	name: z.string().min(1),
});
const SkillLookupInput = ConfigDirInput.extend({
	name: z.string().min(1),
});
const McpSearchInput = z.object({
	q: z.string().min(1),
	cursor: z.string().optional(),
});
const McpDetailInput = z.object({
	name: z.string().min(1),
	version: z.string().min(1).optional(),
});
const McpInstallInput = ConfigDirInput.extend({
	name: z.string().min(1),
	version: z.string().min(1).optional(),
});
const McpUninstallInput = ConfigDirInput.extend({
	name: z.string().min(1),
});

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
				"to wait synchronously for the result. workspaceId is required and links the new " +
				"session to a .puna workspace. If you are delegating from inside a running agent " +
				"thread, set `parent` to your own calling thread ID so the child can notify you " +
				"when done.",
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
				"List all known sub-agent tasks with their id, description, status, " +
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
			description:
				"Check the status of a background sub-agent task by its task id.",
			inputSchema: SessionIdInput.shape,
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
			description:
				"Retrieve the result of a completed background sub-agent task.",
			inputSchema: SessionIdInput.shape,
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
		async ({ id, message, configDir, agentProfile, model }) => {
			const result = await sessionService.sendMessage(id, message, configDir, {
				agentProfile,
				model,
			});
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"delete_session",
		{
			title: "Delete Session",
			description: "Cancel a running sub-agent task and delete its session.",
			inputSchema: SessionIdInput.shape,
		},
		async ({ id }) => {
			await sessionService.delete(id);
			return {
				content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
			};
		},
	);

	server.registerTool(
		"list_agents",
		{
			title: "List Agents",
			description:
				"List available agent profiles in a workspace. Merges local overrides with global defaults, " +
				"local wins on collision. Use this to discover which agent profiles a project can use.",
			inputSchema: ConfigDirInput.shape,
		},
		async ({ configDir }) => {
			const result = await agentService.list(configDir);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"get_agent",
		{
			title: "Get Agent",
			description:
				"Fetch a single agent profile by name, including its system prompt and tool whitelist. " +
				"Resolves local override first, falls back to global default.",
			inputSchema: AgentLookupInput.shape,
		},
		async ({ configDir, name }) => {
			const result = await agentService.get(configDir, name);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"list_skills",
		{
			title: "List Skills",
			description:
				"List available skill packages in a workspace. Merges local overrides with global defaults, " +
				"local wins on collision.",
			inputSchema: ConfigDirInput.shape,
		},
		async ({ configDir }) => {
			const result = await skillService.list(configDir);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"get_skill",
		{
			title: "Get Skill",
			description:
				"Fetch a single skill package by name, including its description and script file list.",
			inputSchema: SkillLookupInput.shape,
		},
		async ({ configDir, name }) => {
			const result = await skillService.get(configDir, name);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"search_mcps",
		{
			title: "Search Public MCPs",
			description:
				"Search the official MCP Registry (registry.modelcontextprotocol.io) for public MCP " +
				"servers by name substring. Returns summaries with package identifier, transport, " +
				"and version. Use get_mcp on a result to inspect env-var requirements before installing.",
			inputSchema: McpSearchInput.shape,
		},
		async ({ q, cursor }) => {
			const result = await mcpRegistry.search(q, { cursor });
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							query: q,
							count: result.servers.length,
							nextCursor: result.nextCursor,
							servers: result.servers,
						}),
					},
				],
			};
		},
	);

	server.registerTool(
		"get_mcp",
		{
			title: "Get Public MCP Detail",
			description:
				"Fetch the full detail of a public MCP from the official registry by its namespaced " +
				"name (e.g. 'io.github.user/my-server'). Returns package version, transport, runtime " +
				"arguments, and the env-var schema (required/secret flags) needed to run it. Pass " +
				"version='latest' (default) or pin a specific version.",
			inputSchema: McpDetailInput.shape,
		},
		async ({ name, version }) => {
			const detail = await mcpRegistry.getLatest(name, { version });
			return { content: [{ type: "text", text: JSON.stringify(detail) }] };
		},
	);

	server.registerTool(
		"list_installed_mcps",
		{
			title: "List Installed MCPs",
			description:
				"List MCPs installed in a workspace's `.puna/mcps/` directory, merged with the global " +
				"config directory's MCPs. Local entries win on name collision. Each entry shows its " +
				"version, npm identifier, transport, and counts of required/secret env vars.",
			inputSchema: ConfigDirInput.shape,
		},
		async ({ configDir }) => {
			const result = await mcpService.listInstalled(configDir);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"install_mcp",
		{
			title: "Install Public MCP",
			description:
				"Install a public MCP from the official registry into the workspace's `.puna/mcps/`. " +
				"Fetches the latest version detail, writes a conf.json describing the npm identifier, " +
				"transport, runtime args, and env-var schema. Refuses (409) if the name is already " +
				"installed locally OR if it would shadow a global install. Actual process spawn and " +
				"env-var value supply happens at agent runtime, not here.",
			inputSchema: McpInstallInput.shape,
		},
		async ({ configDir, name, version }) => {
			const result = await mcpService.install(configDir, name, { version });
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	server.registerTool(
		"uninstall_mcp",
		{
			title: "Uninstall MCP",
			description:
				"Remove a locally-installed MCP's `.puna/mcps/<name>` directory. Refuses to touch " +
				"global-only entries. Any running process spawned from the removed config must be " +
				"stopped by the caller.",
			inputSchema: McpUninstallInput.shape,
		},
		async ({ configDir, name }) => {
			const result = await mcpService.uninstall(configDir, name);
			return { content: [{ type: "text", text: JSON.stringify(result) }] };
		},
	);

	return server;
}
