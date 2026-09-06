# Implementation Plan: Session Manager exposed via local MCP server

## Context

Monorepo with 3 independent packages (no workspace glue):

```
agent-harness/
├── agent/          LangGraph.js agent (CommonJS), runs via `langgraphjs dev` (default port 2024)
├── backend/        Hono + Zod OpenAPI (Bun, ESM), port 3001
├── frontend/       Vite + React 19 + TanStack Router (ESM)
```

`agent/` and `backend/` are **separate processes**. The agent process cannot import backend
code directly, so all cross-process access must go over a protocol.

## Architecture Decision: MCP over raw HTTP fetch

`SessionManager`'s business logic is unchanged — it still lives in `backend/lib/session-manager.ts`
and owns the LangGraph SDK client, the task registry, and concurrency control. What changes is
**how the agent calls it**: instead of hand-written `fetch()` tool wrappers, `backend` exposes
`SessionManager` as an **MCP server**, and `agent/` connects to it as an **MCP client**, using
`@langchain/mcp-adapters` to auto-generate LangChain-compatible tools.

```
BEFORE:
agent/tools/delegate-task.ts --fetch()--> backend/routes/sessions.ts --> SessionManager

AFTER:
agent/ (MultiServerMCPClient) --MCP protocol (Streamable HTTP)--> backend/lib/mcp-server.ts --> SessionManager
```

### Why Streamable HTTP, not stdio

`backend` is a long-lived process holding in-memory state (task registry, concurrency counters,
LangGraph SDK client). stdio transport requires the MCP client to *spawn* the server as a
subprocess — that would mean a second, disconnected instance of `SessionManager` with no shared
state. Instead, mount the MCP server on the **existing Bun/Hono process** at a `/mcp` route using
Streamable HTTP transport (`@hono/mcp`). The agent connects to `http://localhost:3001/mcp` like
any other MCP HTTP server.

The existing REST routes (`routes/sessions.ts`) can stay as-is for manual debugging /
frontend use — both REST and MCP call the same underlying `SessionManager` instance, so there
is no logic duplication, only two transport surfaces.

### Known gotcha: parent thread ID injection

When a tool is auto-loaded from MCP, the LLM has to supply every parameter itself — including a
`parent` thread ID field, if the schema exposes one. Relying on the LLM to correctly recall and
type its own thread ID on every `create` call is unreliable (it can omit it, hallucinate it, or
use a stale one from earlier context).

**Solution:** keep `parent` in the MCP tool's schema (so the child agent *could* theoretically be
told about it), but on the `agent/` side, wrap the MCP-loaded `create` tool in a thin LangChain
`tool()` that silently injects `config.configurable.thread_id` into the call args before
delegating to the real MCP tool — so the LLM never has to know or supply its own thread ID at all.

---

## File Layout to Create / Modify

```
backend/
├── index.ts                    # MODIFY: mount /mcp route + graceful shutdown
├── lib/
│   ├── config.ts                # NEW
│   ├── session-manager.ts       # NEW (unchanged logic from prior plan)
│   └── mcp-server.ts             # NEW — wraps SessionManager as MCP tools
├── routes/
│   └── sessions.ts               # NEW — REST routes, optional/debug, same SessionManager
└── schemas/
    └── session.ts                 # NEW — shared zod schemas for REST + MCP tool input

agent/
└── src/base/tools/
    ├── mcp-client.ts              # NEW — MultiServerMCPClient setup + thread-id injection wrapper
    └── index.ts                    # MODIFY — register MCP-derived tools in existing registry
```

Dependencies to add:

```bash
# backend/
bun add @modelcontextprotocol/sdk @hono/mcp

# agent/
npm install @langchain/mcp-adapters
```

---

## Step 1 — `backend/lib/config.ts`

```ts
export const config = {
  langgraphUrl: process.env.LANGGRAPH_URL ?? "http://localhost:2024",
  graphId: process.env.LANGGRAPH_GRAPH_ID ?? "graph", // must match langgraph.json entry key
  maxConcurrency: {
    default: 3,
  } as Record<string, number>,
};
```

Verify `graphId` against `client.assistants.search()` — don't assume `"graph"` is correct
without checking what LangGraph server actually exposes for `src/base/graph.ts:graph`.

---

## Step 2 — `backend/schemas/session.ts`

Shared zod schemas, used both by REST routes (via `@hono/zod-openapi`) and by the MCP tool
definitions (plain `zod`, no OpenAPI wrapper needed there).

```ts
import { z } from "zod";

export const CreateSessionInput = z.object({
  parent: z.string().optional(),
  prompt: z.string().min(1),
  agentProfile: z.string().default("main-agent"),
  background: z.boolean().default(true),
});

export const TaskIdInput = z.object({
  id: z.string(),
});

export const SendMessageInput = z.object({
  id: z.string(),
  message: z.string().min(1),
});
```

---

## Step 3 — `backend/lib/session-manager.ts`

Unchanged from the original plan — no MCP-specific logic belongs here. This class only knows
about LangGraph threads/runs, not about how it's exposed to callers.

```ts
import { Client } from "@langchain/langgraph-sdk";
import { config } from "./config";

export type TaskStatus = "pending" | "running" | "completed" | "error" | "cancelled";

export interface TaskRecord {
  id: string;
  parentThreadId?: string;
  childThreadId: string;
  runId: string;
  agentProfile: string;
  background: boolean;
  status: TaskStatus;
  createdAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task not found: ${id}`);
  }
}

export class SessionManager {
  private client: Client;
  private registry = new Map<string, TaskRecord>();
  private activeCount = new Map<string, number>();

  constructor() {
    this.client = new Client({ apiUrl: config.langgraphUrl });
  }

  async create(opts: {
    parent?: string;
    prompt: string;
    agentProfile: string;
    background: boolean;
  }) {
    const child = await this.client.threads.create();
    const taskId = `bg_${crypto.randomUUID().slice(0, 8)}`;

    const record: TaskRecord = {
      id: taskId,
      parentThreadId: opts.parent,
      childThreadId: child.thread_id,
      runId: "",
      agentProfile: opts.agentProfile,
      background: opts.background,
      status: "pending",
      createdAt: Date.now(),
    };
    this.registry.set(taskId, record);

    if (!opts.background) {
      record.status = "running";
      const run = await this.client.runs.wait(child.thread_id, config.graphId, {
        input: { messages: [{ role: "human", content: opts.prompt }] },
        config: { configurable: { agent_profile: opts.agentProfile } },
      });
      record.status = "completed";
      record.result = run;
      record.completedAt = Date.now();
      return { taskId, sessionId: child.thread_id, status: record.status, result: run };
    }

    void this.launch(record, opts.prompt); // fire-and-forget
    return { taskId, sessionId: child.thread_id, status: record.status };
  }

  private async launch(record: TaskRecord, prompt: string) {
    await this.acquireSlot(record.agentProfile);
    record.status = "running";

    try {
      const run = await this.client.runs.create(record.childThreadId, config.graphId, {
        input: { messages: [{ role: "human", content: prompt }] },
        config: { configurable: { agent_profile: record.agentProfile } },
      });
      record.runId = run.run_id;

      await this.waitForCompletion(record);

      const state = await this.client.threads.getState(record.childThreadId);
      record.status = "completed";
      record.result = state.values;
      record.completedAt = Date.now();
    } catch (e) {
      record.status = "error";
      record.error = String(e);
      record.completedAt = Date.now();
    } finally {
      this.releaseSlot(record.agentProfile);
      if (record.parentThreadId) {
        await this.notifyParent(record).catch((e) =>
          console.error(`notifyParent failed for ${record.id}:`, e)
        );
      }
    }
  }

  private async waitForCompletion(record: TaskRecord) {
    try {
      for await (const _chunk of this.client.runs.joinStream(
        record.childThreadId,
        record.runId
      )) {
        // no-op for now; can stream tool-call progress later
      }
    } catch {
      while (true) {
        const run = await this.client.runs.get(record.childThreadId, record.runId);
        if (run.status === "success" || run.status === "error") return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async notifyParent(record: TaskRecord) {
    if (!record.parentThreadId) return;

    const siblingsStillRunning = [...this.registry.values()].some(
      (r) =>
        r.id !== record.id &&
        r.parentThreadId === record.parentThreadId &&
        r.status === "running"
    );

    const notification = this.renderReminder(record, siblingsStillRunning);

    // "noReply=true" equivalent: inject message into state, do NOT create a run
    await this.client.threads.updateState(record.parentThreadId, {
      values: { messages: [{ role: "system", content: notification }] },
    });

    // "noReply=false" equivalent: all siblings done -> wake parent for real
    if (!siblingsStillRunning) {
      await this.client.runs.create(record.parentThreadId, config.graphId, {
        input: null,
      });
    }
  }

  private renderReminder(record: TaskRecord, stillRunning: boolean) {
    const lines = [`[BACKGROUND TASK ${record.status.toUpperCase()}]`, `ID: ${record.id}`];
    if (record.status === "error") lines.push(`Error: ${record.error}`);
    lines.push(
      stillRunning
        ? "Other background tasks still running. Do NOT poll."
        : "All background tasks complete."
    );
    lines.push(`Use get_result(id="${record.id}") to retrieve output.`);
    return lines.join("\n");
  }

  async getStatus(id: string) {
    const r = this.registry.get(id);
    if (!r) throw new TaskNotFoundError(id);
    return { status: r.status, createdAt: r.createdAt, completedAt: r.completedAt };
  }

  async getResult(id: string) {
    const r = this.registry.get(id);
    if (!r) throw new TaskNotFoundError(id);
    if (r.status !== "completed" && r.status !== "error") return { status: r.status };
    return { status: r.status, result: r.result };
  }

  async sendMessage(id: string, message: string) {
    const r = this.registry.get(id);
    if (!r) throw new TaskNotFoundError(id);
    const run = await this.client.runs.wait(r.childThreadId, config.graphId, {
      input: { messages: [{ role: "human", content: message }] },
      config: { configurable: { agent_profile: r.agentProfile } },
    });
    r.result = run;
    return run;
  }

  async delete(id: string) {
    const r = this.registry.get(id);
    if (!r) throw new TaskNotFoundError(id);
    if (r.status === "running" && r.runId) {
      await this.client.runs.cancel(r.childThreadId, r.runId).catch(() => {});
    }
    await this.client.threads.delete(r.childThreadId).catch(() => {});
    this.registry.delete(id);
  }

  private async acquireSlot(key: string) {
    const limit = config.maxConcurrency[key] ?? config.maxConcurrency.default;
    while ((this.activeCount.get(key) ?? 0) >= limit) {
      await new Promise((r) => setTimeout(r, 500));
    }
    this.activeCount.set(key, (this.activeCount.get(key) ?? 0) + 1);
  }

  private releaseSlot(key: string) {
    this.activeCount.set(key, Math.max(0, (this.activeCount.get(key) ?? 1) - 1));
  }

  async cancelAll() {
    const running = [...this.registry.values()].filter((r) => r.status === "running");
    await Promise.all(running.map((r) => this.delete(r.id).catch(() => {})));
  }
}

export const sessionManager = new SessionManager();
```

---

## Step 4 — `backend/lib/mcp-server.ts` (NEW — the core of this change)

Wraps `SessionManager` methods as MCP tools using the official `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sessionManager } from "./session-manager";
import { CreateSessionInput, TaskIdInput, SendMessageInput } from "../schemas/session";

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
        "Spawn a sub-agent session to work on a task. Set background=true to continue working " +
        "while it runs; you'll be notified when it completes. Set background=false to wait " +
        "synchronously for the result.",
      inputSchema: CreateSessionInput.shape,
    },
    async (args) => {
      const result = await sessionManager.create(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "get_session_status",
    {
      title: "Get Session Status",
      description: "Check the status of a background sub-agent task by its task id.",
      inputSchema: TaskIdInput.shape,
    },
    async ({ id }) => {
      const result = await sessionManager.getStatus(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "get_session_result",
    {
      title: "Get Session Result",
      description: "Retrieve the result of a completed background sub-agent task.",
      inputSchema: TaskIdInput.shape,
    },
    async ({ id }) => {
      const result = await sessionManager.getResult(id);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
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
      const result = await sessionManager.sendMessage(id, message);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "delete_session",
    {
      title: "Delete Session",
      description: "Cancel a running sub-agent task and delete its session.",
      inputSchema: TaskIdInput.shape,
    },
    async ({ id }) => {
      await sessionManager.delete(id);
      return { content: [{ type: "text", text: JSON.stringify({ deleted: true }) }] };
    }
  );

  return server;
}
```

---

## Step 5 — Mount MCP server on the Hono app

Using `@hono/mcp`'s `StreamableHTTPTransport` to bridge the MCP server into the existing Hono
app, at `/mcp`.

```ts
// backend/index.ts (additions)
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./lib/mcp-server";
import { sessionRoutes } from "./routes/sessions";
import { sessionManager } from "./lib/session-manager";

// ... existing OpenAPIHono app setup, existing GET / and GET /health ...

app.route("/api", sessionRoutes); // REST routes stay for debugging

const mcpServer = buildMcpServer();
app.all("/mcp", async (c) => {
  const transport = new StreamableHTTPTransport();
  await mcpServer.connect(transport);
  return transport.handleRequest(c);
});

process.on("SIGINT", async () => {
  await sessionManager.cancelAll();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await sessionManager.cancelAll();
  process.exit(0);
});
```

> Check `@hono/mcp`'s current API — `StreamableHTTPTransport` construction/session-handling
> details can differ between versions. Confirm whether it needs per-request or per-session
> transport instantiation before wiring this in.

---

## Step 6 — `agent/src/base/tools/mcp-client.ts` (NEW)

Connects to the backend's MCP server and converts its tools into LangChain tools, then wraps
`create_session` specifically to auto-inject the current thread ID as `parent` — the LLM never
sees or has to fill in that field.

```ts
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const BACKEND_MCP_URL = process.env.BACKEND_MCP_URL ?? "http://localhost:3001/mcp";

let mcpClient: MultiServerMCPClient | null = null;

async function getMcpClient() {
  if (!mcpClient) {
    mcpClient = new MultiServerMCPClient({
      sessionManager: {
        transport: "http",
        url: BACKEND_MCP_URL,
      },
    });
  }
  return mcpClient;
}

/**
 * Loads all session-manager MCP tools, but replaces the raw `create_session` tool
 * with a wrapper that auto-injects the current graph run's thread_id as `parent`,
 * so the LLM never has to know or supply its own thread ID.
 */
export async function loadSessionManagerTools() {
  const client = await getMcpClient();
  const rawTools = await client.getTools();

  const rawCreate = rawTools.find((t) => t.name === "create_session");
  const otherTools = rawTools.filter((t) => t.name !== "create_session");

  if (!rawCreate) {
    throw new Error("create_session tool not found on MCP server — check backend /mcp is up");
  }

  const wrappedCreate = tool(
    async (input, config) => {
      const parentThreadId = config?.configurable?.thread_id;
      return rawCreate.invoke({ ...input, parent: parentThreadId });
    },
    {
      name: "create_session",
      description: rawCreate.description,
      // omit `parent` from the schema the LLM sees — it's injected automatically
      schema: z.object({
        prompt: z.string(),
        agentProfile: z.string().default("main-agent"),
        background: z.boolean().default(true),
      }),
    }
  );

  return [wrappedCreate, ...otherTools];
}
```

> Verify `@langchain/mcp-adapters`' exact config shape for `MultiServerMCPClient` (transport
> type naming — `"http"` vs `"streamable_http"` — has varied across versions) against
> whatever version ends up in `package.json`.

---

## Step 7 — Modify `agent/src/base/tools/index.ts`

Register the MCP-derived tools alongside the existing local tools (`file-tools`, `http-tools`,
`shell-tool`, `sql-tools`, `upsert-mem`). Since tool loading is now async (MCP handshake),
the registry's assembly point needs to support async initialization if it doesn't already.

```ts
import { loadSessionManagerTools } from "./mcp-client";
// ... existing tool imports ...

export async function buildToolRegistry() {
  const sessionTools = await loadSessionManagerTools();
  return [
    ...existingLocalTools, // file-tools, http-tools, shell-tool, sql-tools, upsert-mem
    ...sessionTools,
  ];
}
```

> Check how `graph.ts` currently wires tools into the graph (`call-tool.ts` node) — if tool
> assembly is currently synchronous, this introduces an async boundary that needs to be
> resolved once at graph build time, not per-invocation.

---

## Open Decisions / Things to Verify Before Merging

1. **`config.graphId`** must match the actual assistant/graph id LangGraph server exposes.
   Verify with `client.assistants.search()`.
2. **`@hono/mcp` transport API** — confirm current version's `StreamableHTTPTransport` usage
   pattern (session-per-request vs. persistent) before wiring into `index.ts`.
3. **`@langchain/mcp-adapters` transport config shape** — confirm exact keys/values for HTTP
   transport in the installed version.
4. **`runs.joinStream` API shape** in `@langchain/langgraph-sdk` — check for version drift.
5. **In-memory registry** in `SessionManager` does not survive a `backend` process restart.
   Acceptable for MVP; back with Redis/SQLite later if durability is needed.
6. **`acquireSlot` uses a naive `setTimeout` polling loop** — replace with `p-queue` if
   concurrency becomes a real bottleneck.
7. **Wake policy** waits for ALL sibling tasks under a parent to complete before creating a
   new parent run. Drop the `!siblingsStillRunning` guard if per-task wake is preferred
   (more frequent but lower-latency parent runs).
8. **Async tool registry init** — confirm `agent/src/base/graph.ts` and `call-tool.ts` can
   accommodate an async tool-loading step without breaking `langgraphjs dev`'s hot reload.
9. **`docker-compose.yml` is currently empty** — once `agent`, `backend`, `frontend` are all
   verified working together manually, fill in compose so MCP connectivity between processes
   is guaranteed at container-network level, not just `localhost`.

## Testing Checklist for Coding Agent

- [ ] `GET http://localhost:3001/mcp` (or appropriate MCP handshake request) responds — MCP
      server is reachable independently of the agent.
- [ ] From `agent/`, `loadSessionManagerTools()` returns 5 tools without throwing.
- [ ] Calling `create_session` from within a running graph does NOT require the LLM to supply
      `parent` — verify the injected thread_id matches the actual invoking thread.
- [ ] `background: false` create call blocks and returns a result synchronously.
- [ ] `background: true` create call returns immediately with a `pending` status.
- [ ] `get_session_status` reflects `pending` → `running` → `completed` transitions.
- [ ] `get_session_result` returns `{status: "running"}` before completion, full result after.
- [ ] Parent thread's state gets a `system` message injected on child completion WITHOUT a new
      run appearing, when other sibling tasks are still running.
- [ ] Parent thread gets an actual new run created once ALL sibling background tasks for it
      are done.
- [ ] `send_session_message` continues the same child thread (verify via `threads.getState`
      history length increasing, not a new thread being created).
- [ ] `delete_session` cancels the run and removes the thread; subsequent `get_session_status`
      throws/errors appropriately.
- [ ] Killing the `backend` process (SIGINT) cancels all currently running child threads before
      exit, and the MCP connection from `agent/` fails gracefully rather than hanging.