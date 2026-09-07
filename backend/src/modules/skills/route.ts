import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { SkillService, SkillNotFoundError } from "./service";
import { InvalidWorkspaceError } from "../../global/workspace-context";
import {
	ConfigDirQuery,
	SkillNameParam,
	SkillsListResponse,
	SkillDetailResponse,
	ErrorResponse,
} from "./schema";

const skillService = new SkillService();
const app = new OpenAPIHono();

const listRoute = createRoute({
	method: "get",
	path: "/skills",
	request: { query: ConfigDirQuery },
	responses: {
		200: {
			description: "List skills in workspace (local + global, local wins on collision)",
			content: { "application/json": { schema: SkillsListResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["skills"],
});

const detailRoute = createRoute({
	method: "get",
	path: "/skills/:name",
	request: {
		params: SkillNameParam,
		query: ConfigDirQuery,
	},
	responses: {
		200: {
			description: "Skill detail with description and script list",
			content: { "application/json": { schema: SkillDetailResponse } },
		},
		400: {
			description: "Invalid workspace",
			content: { "application/json": { schema: ErrorResponse } },
		},
		404: {
			description: "Skill not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
	tags: ["skills"],
});

app.openapi(listRoute, async (c) => {
	const { configDir } = c.req.valid("query");
	try {
		const result = await skillService.list(configDir);
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
		const result = await skillService.get(configDir, name);
		return c.json(result, 200);
	} catch (e) {
		if (e instanceof SkillNotFoundError) return c.json({ error: e.message }, 404);
		if (e instanceof InvalidWorkspaceError) return c.json({ error: e.message }, 400);
		throw e;
	}
});

export { app as skillRoutes };