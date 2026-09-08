import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { SessionService } from "./service";
import { SessionNotFoundError } from "./repository";
import { AgentRuntimeError } from "../../global/agent-runtime";
import { ThreadBusyError } from "../../global/errors";
import { streamBus, ConnectionMux } from "../../global/stream-bus";
import { StreamMessageInput } from "./schema";

const sessionService = new SessionService();

const app = new OpenAPIHono();

const SessionSummarySchema = z
	.object({
		id: z.string(),
		workspaceId: z.string(),
		description: z.string(),
		status: z.string(),
		agentProfile: z.string(),
		createdAt: z.number(),
		completedAt: z.number().optional(),
	})
	.openapi("SessionSummary");

const CreateSessionSchema = z
	.object({
		workspaceId: z.string().min(1),
		parent: z.string().optional(),
		description: z.string().min(1),
		prompt: z.string().min(1),
		agentProfile: z.string().default("semar"),
		background: z.boolean().default(true),
		// When true (default) a background=true session auto-launches its run.
		// Chat callers set start=false: the thread is created now and the run
		// happens via the /stream endpoint instead, avoiding a double-run.
		start: z.boolean().default(true),
		configDir: z.string().min(1),
		model: z.string().optional(),
	})
	.openapi("CreateSessionInput");

const WorkspaceIdQuerySchema = z
	.object({ workspaceId: z.string().min(1) })
	.openapi("WorkspaceIdQuery");

const SessopmIdParamSchema = z
	.object({ id: z.string() })
	.openapi("SessionIdParam");

const SendMessageSchema = z
	.object({
		message: z.string().min(1),
		configDir: z.string().min(1),
		agentProfile: z.string().optional(),
		model: z.string().optional(),
	})
	.openapi("SendMessageInput");

const NotFoundSchema = z.object({ error: z.string() }).openapi("NotFound");

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
	request: { query: WorkspaceIdQuerySchema },
	responses: {
		200: {
			description: "Sessions (filtered by workspaceId when provided)",
			content: {
				"application/json": { schema: z.array(SessionSummarySchema) },
			},
		},
	},
	tags: ["sessions"],
});

const statusRouteDef = createRoute({
	method: "get",
	path: "/sessions/:id",
	request: { params: SessopmIdParamSchema },
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
	request: { params: SessopmIdParamSchema },
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
		params: SessopmIdParamSchema,
		body: { content: { "application/json": { schema: SendMessageSchema } } },
	},
	responses: {
		200: {
			description: "Message sent",
			content: { "application/json": { schema: z.any() } },
		},
		409: {
			description: "Session is still running a task",
			content: { "application/json": { schema: NotFoundSchema } },
		},
		404: {
			description: "Session not found",
			content: { "application/json": { schema: NotFoundSchema } },
		},
	},
	tags: ["sessions"],
});

const streamRouteDef = createRoute({
	method: "post",
	path: "/sessions/:id/stream",
	request: {
		params: SessopmIdParamSchema,
		body: { content: { "application/json": { schema: StreamMessageInput } } },
	},
	responses: {
		202: {
			description: "Run started; events are relayed over GET /sessions/stream",
			content: { "application/json": { schema: z.any() } },
		},
		400: {
			description: "Agent/config error",
			content: { "application/json": { schema: NotFoundSchema } },
		},
		409: {
			description: "Session is still running a task",
			content: { "application/json": { schema: NotFoundSchema } },
		},
		404: {
			description: "Session not found",
			content: { "application/json": { schema: NotFoundSchema } },
		},
	},
	tags: ["sessions"],
});

const cancelRouteDef = createRoute({
	method: "post",
	path: "/sessions/:id/cancel",
	request: { params: SessopmIdParamSchema },
	responses: {
		200: {
			description: "Cancel requested",
			content: { "application/json": { schema: z.any() } },
		},
		404: {
			description: "Session not found",
			content: { "application/json": { schema: NotFoundSchema } },
		},
	},
	tags: ["sessions"],
});

const messagesRouteDef = createRoute({
	method: "get",
	path: "/sessions/:id/messages",
	request: { params: SessopmIdParamSchema },
	responses: {
		200: {
			description: "Session message history",
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
	request: { params: SessopmIdParamSchema },
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

// SSE firehose — relay for the global StreamBus. Kept as a plain Hono route
// (not openapi) since SSE is not represented cleanly in the OpenAPI doc.
// Registered BEFORE the /sessions/:id param routes: this router resolves
// static/param conflicts by registration order, and /sessions/stream must
// not be swallowed by /sessions/:id.
app.get("/sessions/stream", (c) => {
	const workspaceId = c.req.query("workspaceId");
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const mux = new ConnectionMux(workspaceId);
			mux.attach(controller, encoder);
			c.req.raw.signal.addEventListener("abort", () => mux.detach());
		},
		cancel() {
			// mux already detached via abort listener
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		},
	});
});

app.openapi(createRouteDef, async (c) => {
	const body = c.req.valid("json");
	const result = await sessionService.create(body);
	return c.json(result, 200);
});

app.openapi(listRouteDef, async (c) => {
	const { workspaceId } = c.req.valid("query");
	const rows = await sessionService.list({ workspaceId });
	return c.json(rows, 200);
});

app.openapi(statusRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		return c.json(await sessionService.getStatus(id), 200);
	} catch (e) {
		if (e instanceof SessionNotFoundError)
			return c.json({ error: e.message }, 404);
		throw e;
	}
});

app.openapi(resultRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		return c.json(await sessionService.getResult(id), 200);
	} catch (e) {
		if (e instanceof SessionNotFoundError)
			return c.json({ error: e.message }, 404);
		throw e;
	}
});

app.openapi(messageRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	const { message, configDir, agentProfile, model } = c.req.valid("json");
	try {
		return c.json(
			await sessionService.sendMessage(id, message, configDir, {
				agentProfile,
				model,
			}),
			200,
		);
	} catch (e) {
		if (e instanceof SessionNotFoundError)
			return c.json({ error: e.message }, 404);
		if (e instanceof ThreadBusyError)
			return c.json({ error: e.message }, 409);
		throw e;
	}
});

app.openapi(streamRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	const { message, configDir, agentProfile, model } = c.req.valid("json");
	try {
		const result = await sessionService.startRun(id, message, configDir, {
			agentProfile,
			model,
		});
		return c.json(result, 202);
	} catch (e) {
		if (e instanceof SessionNotFoundError)
			return c.json({ error: e.message }, 404);
		if (e instanceof ThreadBusyError)
			return c.json({ error: e.message }, 409);
		if (e instanceof AgentRuntimeError)
			return c.json({ error: e.message }, 400);
		throw e;
	}
});

app.openapi(cancelRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		await sessionService.cancelRun(id);
		return c.json({ status: "cancelled" }, 200);
	} catch (e) {
		if (e instanceof SessionNotFoundError)
			return c.json({ error: e.message }, 404);
		throw e;
	}
});

app.openapi(messagesRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		return c.json(await sessionService.getMessages(id), 200);
	} catch (e) {
		if (e instanceof SessionNotFoundError)
			return c.json({ error: e.message }, 404);
		throw e;
	}
});

app.openapi(deleteRouteDef, async (c) => {
	const { id } = c.req.valid("param");
	try {
		await sessionService.delete(id);
		return c.json({ deleted: true }, 200);
	} catch (e) {
		if (e instanceof SessionNotFoundError)
			return c.json({ error: e.message }, 404);
		throw e;
	}
});

/**
 * Wire the SSE workspace filter. The bus itself must not import modules, so
 * the session→workspace lookup is injected from server.ts at boot.
 */
export function setStreamBusWorkspaceResolver(
	resolver: (sessionId: string) => string | undefined,
): void {
	streamBus.setWorkspaceResolver(resolver);
}

export { app as sessionRoutes };