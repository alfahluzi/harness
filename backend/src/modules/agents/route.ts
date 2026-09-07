import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { AgentService, AgentNotFoundError } from "./service";
import { InvalidWorkspaceError } from "../../global/workspace-context";
import {
	ConfigDirQuery,
	AgentNameParam,
	AgentsListResponse,
	AgentDetailResponse,
	ErrorResponse,
} from "./schema";

const agentService = new AgentService();
const app = new OpenAPIHono();

const listRoute = createRoute({
	method: "get",
	path: "/agents",
	request: { query: ConfigDirQuery },
	responses: {
		200: {
			description: "List agents in workspace (local + global, local wins on collision)",
			content: { "application/json": { schema: AgentsListResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["agents"],
});

const detailRoute = createRoute({
	method: "get",
	path: "/agents/:name",
	request: {
		params: AgentNameParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Agent detail with prompt and resolved source",
			content: { "application/json": { schema: AgentDetailResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Agent not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["agents"],
});

app.openapi(listRoute, async (c) => {
	const { configDir } = c.req.valid("query");
	try {
		const result = await agentService.list(configDir);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(detailRoute, async (c) => {
	const { name } = c.req.valid("param");
	const { configDir } = c.req.valid("query");
	try {
		const result = await agentService.get(configDir, name);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof AgentNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

export { app as agentRoutes };