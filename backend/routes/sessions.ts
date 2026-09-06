import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { sessionManager, TaskNotFoundError } from "../lib/session-manager";

const app = new OpenAPIHono();

const SessionSummarySchema = z
	.object({
		id: z.string(),
		description: z.string(),
		status: z.string(),
		agentProfile: z.string(),
		createdAt: z.number(),
		completedAt: z.number().optional(),
	})
	.openapi("SessionSummary");

const CreateSessionSchema = z
	.object({
		parent: z.string().optional(),
		description: z.string().min(1),
		prompt: z.string().min(1),
		agentProfile: z.string().default("main-agent"),
		background: z.boolean().default(true),
	})
	.openapi("CreateSessionInput");

const TaskIdParamSchema = z
	.object({ id: z.string() })
	.openapi("TaskIdParam");

const SendMessageSchema = z
	.object({ message: z.string().min(1) })
	.openapi("SendMessageInput");

const NotFoundSchema = z
	.object({ error: z.string() })
	.openapi("NotFound");

const createRouteDef = createRoute({
	method: "post",
	path: "/sessions",
	request: {
		body: { content: { "application/json": { schema: CreateSessionSchema } } },
	},
	responses: {
		200: {
			description: "Session created",
			content: { "application/json": { schema: z.any() } },
		},
	},
	tags: ["sessions"],
});

const listRouteDef = createRoute({
	method: "get",
	path: "/sessions",
	responses: {
		200: {
			description: "All known sessions",
			content: { "application/json": { schema: z.array(SessionSummarySchema) } },
		},
	},
	tags: ["sessions"],
});

const statusRouteDef = createRoute({
	method: "get",
	path: "/sessions/:id",
	request: { params: TaskIdParamSchema },
	responses: {
		200: {
			description: "Session status",
			content: { "application/json": { schema: z.any() } },
		},
		404: {
			description: "Session not found",
			content: { "application/json": { schema: NotFoundSchema } },
		},
	},
	tags: ["sessions"],
});

const resultRouteDef = createRoute({
	method: "get",
	path: "/sessions/:id/result",
	request: { params: TaskIdParamSchema },
	responses: {
		200: {
			description: "Session result",
			content: { "application/json": { schema: z.any() } },
		},
		404: {
			description: "Session not found",
			content: { "application/json": { schema: NotFoundSchema } },
		},
	},
	tags: ["sessions"],
});

const messageRouteDef = createRoute({
	method: "post",
	path: "/sessions/:id/message",
	request: {
		params: TaskIdParamSchema,
		body: { content: { "application/json": { schema: SendMessageSchema } } },
	},
	responses: {
		200: {
			description: "Message sent",
			content: { "application/json": { schema: z.any() } },
		},
		404: {
			description: "Session not found",
			content: { "application/json": { schema: NotFoundSchema } },
		},
	},
	tags: ["sessions"],
});

const deleteRouteDef = createRoute({
	method: "delete",
	path: "/sessions/:id",
	request: { params: TaskIdParamSchema },
	responses: {
		200: {
			description: "Session deleted",
			content: { "application/json": { schema: z.any() } },
		},
		404: {
			description: "Session not found",
			content: { "application/json": { schema: NotFoundSchema } },
		},
	},
	tags: ["sessions"],
});

app.openapi(createRouteDef, async (c) => {
	const body = c.req.valid("json");
	const result = await sessionManager.create(body);
	return c.json(result, 200);
});

app.openapi(listRouteDef, async (c) => {
	const rows = await sessionManager.list();
	return c.json(rows, 200);
});

app.openapi(statusRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		return c.json(await sessionManager.getStatus(id), 200);
	} catch (e) {
		if (e instanceof TaskNotFoundError) return c.json({ error: e.message }, 404);
		throw e;
	}
});

app.openapi(resultRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		return c.json(await sessionManager.getResult(id), 200);
	} catch (e) {
		if (e instanceof TaskNotFoundError) return c.json({ error: e.message }, 404);
		throw e;
	}
});

app.openapi(messageRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	const { message } = c.req.valid("json");
	try {
		return c.json(await sessionManager.sendMessage(id, message), 200);
	} catch (e) {
		if (e instanceof TaskNotFoundError) return c.json({ error: e.message }, 404);
		throw e;
	}
});

app.openapi(deleteRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		await sessionManager.delete(id);
		return c.json({ deleted: true }, 200);
	} catch (e) {
		if (e instanceof TaskNotFoundError) return c.json({ error: e.message }, 404);
		throw e;
	}
});

export { app as sessionRoutes };