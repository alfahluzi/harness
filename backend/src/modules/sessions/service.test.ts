import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@langchain/langgraph-sdk";
import {
	streamBus,
	ConnectionMux,
	StreamBus,
	type StreamEvent,
} from "../../global/stream-bus";
import type {
	SessionRepository,
	SessionRecord,
	SessionStatus,
} from "./repository";

// db.ts reads SQLITE_PATH at module-eval time; point it at a throwaway temp
// file DB before the first dynamic import triggers it (service → agent-runtime
// → global/db). The provider row below lets resolveAgentRuntimeConfig succeed
// without touching any real database file.
process.env.SQLITE_PATH = join(tmpdir(), `puna-sessions-test-${process.pid}.db`);

const WORKSPACE_ID = "ws-test-svc";
const CREATE_PROVIDERS_SQL = `
CREATE TABLE IF NOT EXISTS providers (
	id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	type TEXT NOT NULL,
	name TEXT NOT NULL,
	base_url TEXT NOT NULL,
	api_key TEXT NOT NULL,
	default_model TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (id, workspace_id)
);
`;

const CREATE_PROVIDER_MODELS_SQL = `
CREATE TABLE IF NOT EXISTS provider_models (
	workspace_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	model_id TEXT NOT NULL,
	name TEXT,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, provider_id, model_id)
);
`;

let SessionServiceCtor: typeof import("./service").SessionService;
let configDir: string;
let projectRoot: string;

const encoder = new TextEncoder();

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), "puna-sessions-svc-"));
	configDir = join(projectRoot, ".puna");
	await mkdir(configDir, { recursive: true });
	await writeFile(
		join(configDir, "config.json"),
		JSON.stringify({ id: WORKSPACE_ID, version: 1 }, null, 2),
	);
	const agentDir = join(configDir, "agents", "coder");
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "prompt.md"), "You are a test agent.");
	await writeFile(
		join(agentDir, "conf.json"),
		JSON.stringify({ providerId: "test-provider", modelId: "test-model" }, null, 2),
	);

	const { sqliteDb } = await import("../../global/db");
	sqliteDb.run(CREATE_PROVIDERS_SQL);
	sqliteDb.run(CREATE_PROVIDER_MODELS_SQL);
	sqliteDb.run(
		`INSERT OR IGNORE INTO providers
			(id, workspace_id, type, name, base_url, api_key, default_model, created_at, updated_at)
		 VALUES ('test-provider', ?, 'test', 'Test Provider', 'http://localhost:9999', 'sk-test', 'test-model', 0, 0)`,
		[WORKSPACE_ID],
	);

	({ SessionService: SessionServiceCtor } = await import("./service"));
});

afterAll(async () => {
	await rm(projectRoot, { recursive: true, force: true });
	await rm(process.env.SQLITE_PATH!, { force: true });
	await rm(`${process.env.SQLITE_PATH!}-wal`, { force: true });
	await rm(`${process.env.SQLITE_PATH!}-shm`, { force: true });
});

afterEach(() => {
	streamBus.setWorkspaceResolver(undefined);
	streamBus.publish = StreamBus.prototype.publish;
	streamBus.removeAllListeners("event");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockController(): {
	controller: ReadableStreamDefaultController<Uint8Array>;
	chunks: string[];
} {
	const chunks: string[] = [];
	const controller = {
		enqueue: (chunk: Uint8Array) => {
			chunks.push(new TextDecoder().decode(chunk));
		},
		close: () => {},
		error: () => {},
	} as unknown as ReadableStreamDefaultController<Uint8Array>;
	return { controller, chunks };
}

function parseEvent(frame: string): StreamEvent {
	return JSON.parse(frame.slice("data: ".length)) as StreamEvent;
}

function waitForEvent(
	predicate: (event: StreamEvent) => boolean,
	timeoutMs = 3000,
): Promise<StreamEvent> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			streamBus.off("event", listener);
			reject(new Error("timed out waiting for stream event"));
		}, timeoutMs);
		const listener = (event: StreamEvent) => {
			if (!predicate(event)) return;
			clearTimeout(timer);
			streamBus.off("event", listener);
			resolve(event);
		};
		streamBus.on("event", listener);
	});
}

class FakeSessionRepo {
	private rows = new Map<string, SessionRecord>();

	insert(record: SessionRecord): void {
		this.rows.set(record.id, { ...record });
	}
	get(id: string): SessionRecord | null {
		return this.rows.get(id) ?? null;
	}
	getOrThrow(id: string): SessionRecord {
		const row = this.rows.get(id);
		if (!row) throw new Error(`Session not found: ${id}`);
		return row;
	}
	list(): SessionRecord[] {
		return [...this.rows.values()];
	}
	listByWorkspace(workspaceId: string): SessionRecord[] {
		return this.list().filter((r) => r.workspaceId === workspaceId);
	}
	listByParent(parentThreadId: string): SessionRecord[] {
		return this.list().filter((r) => r.parentThreadId === parentThreadId);
	}
	setStatus(id: string, status: SessionStatus): void {
		const row = this.rows.get(id);
		if (row) row.status = status;
	}
	setRunId(id: string, runId: string): void {
		const row = this.rows.get(id);
		if (row) row.runId = runId;
	}
	setResult(id: string, result: unknown, completedAt: number): void {
		const row = this.rows.get(id);
		if (row) {
			row.status = "completed";
			row.result = result;
			row.completedAt = completedAt;
		}
	}
	setError(id: string, error: string, completedAt: number): void {
		const row = this.rows.get(id);
		if (row) {
			row.status = "error";
			row.error = error;
			row.completedAt = completedAt;
		}
	}
	delete(id: string): void {
		this.rows.delete(id);
	}
	getRunningSessions(): SessionRecord[] {
		return this.list().filter((r) => r.status === "running");
	}
}

type FakeStreamPart = { event: string; data: unknown };

function makeRecord(id: string, childThreadId: string): SessionRecord {
	return {
		id,
		workspaceId: WORKSPACE_ID,
		description: "test",
		parentThreadId: undefined,
		childThreadId,
		runId: "",
		agentProfile: "coder",
		background: true,
		configDir,
		status: "pending",
		createdAt: Date.now(),
	};
}

function makeFakeClient(opts: {
	runId: string;
	parts?: FakeStreamPart[];
	joinStream?: () => AsyncGenerator<FakeStreamPart>;
}): Client {
	const joinStream =
		opts.joinStream ??
		(async function* () {
			for (const part of opts.parts ?? []) yield part;
		});
	return {
		runs: {
			create: async () => ({ run_id: opts.runId }),
			cancel: async () => undefined,
			list: async () => [] as Array<{ status: string }>,
			joinStream,
		},
		threads: {
			getState: async () => ({ values: { messages: [] } }),
		},
	} as unknown as Client;
}

// ---------------------------------------------------------------------------
// StreamBus + ConnectionMux
// ---------------------------------------------------------------------------

describe("StreamBus", () => {
	test("publish → ConnectionMux relay in order with per-run seq 0,1,2", () => {
		const mux = new ConnectionMux(undefined, {
			bus: streamBus,
			heartbeatMs: 60_000,
		});
		const { controller, chunks } = mockController();

		streamBus.publish("s1", "run-1", "messages", { text: "a" });
		streamBus.publish("s1", "run-1", "updates", { node: "b" });
		streamBus.publish("s1", "run-1", "done", null);
		mux.attach(controller, encoder);

		const events = chunks.map(parseEvent);
		expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
		expect(events.map((e) => e.type)).toEqual(["messages", "updates", "done"]);
		expect(events[0]!.runId).toBe("run-1");
		expect(events[0]!.ts).toBeGreaterThan(0);
		mux.detach();
	});

	test("bounded queue drops oldest when full", () => {
		const mux = new ConnectionMux(undefined, {
			bus: streamBus,
			queueCap: 10,
			heartbeatMs: 60_000,
		});
		const { controller, chunks } = mockController();

		for (let i = 0; i < 60; i++) {
			streamBus.publish(`s${i}`, `run-${i}`, "messages", i);
		}
		mux.attach(controller, encoder);

		const events = chunks.map(parseEvent);
		expect(events).toHaveLength(10);
		expect(events[0]!.sessionId).toBe("s50"); // oldest dropped
		expect(events[9]!.sessionId).toBe("s59"); // newest kept
		mux.detach();
	});

	test("heartbeat keepalive frames while attached", async () => {
		const mux = new ConnectionMux(undefined, {
			bus: streamBus,
			heartbeatMs: 30,
		});
		const { controller, chunks } = mockController();
		mux.attach(controller, encoder);

		await new Promise((r) => setTimeout(r, 130));
		mux.detach();

		expect(chunks.some((f) => f.startsWith(": keepalive"))).toBe(true);
	});

	test("per-run seq resets for a new run and continues for a resumed one", () => {
		const mux = new ConnectionMux(undefined, {
			bus: streamBus,
			heartbeatMs: 60_000,
		});
		const { controller, chunks } = mockController();
		mux.attach(controller, encoder);

		streamBus.publish("s1", "A", "messages", 1);
		streamBus.publish("s1", "A", "messages", 2);
		streamBus.publish("s1", "A", "messages", 3);
		streamBus.publish("s1", "B", "messages", 4); // new run → seq 0
		streamBus.publish("s1", "A", "messages", 5); // run A not done → seq 3

		const events = chunks.map(parseEvent);
		expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 0, 3]);
		expect(events.map((e) => e.runId)).toEqual(["A", "A", "A", "B", "A"]);
		mux.detach();
	});

	test("workspaceId filter only forwards matching sessions", () => {
		streamBus.setWorkspaceResolver((sessionId) =>
			sessionId.startsWith("s-x") ? "ws-X" : "ws-Y",
		);
		const mux = new ConnectionMux("ws-X", {
			bus: streamBus,
			heartbeatMs: 60_000,
		});
		const { controller, chunks } = mockController();
		mux.attach(controller, encoder);

		streamBus.publish("s-y", "r-y", "messages", 0);
		streamBus.publish("s-x1", "r-1", "messages", 0);
		streamBus.publish("s-x2", "r-2", "messages", 0);

		const events = chunks.map(parseEvent);
		expect(events.map((e) => e.sessionId)).toEqual(["s-x1", "s-x2"]);
		mux.detach();
	});
});

// ---------------------------------------------------------------------------
// SessionService.startRun → detached consumeRunToBus
// ---------------------------------------------------------------------------

describe("SessionService.startRun", () => {
	function makeService(repo: FakeSessionRepo, client: Client) {
		return new SessionServiceCtor(
			repo as unknown as SessionRepository,
			client,
		);
	}

	test("persists result BEFORE publishing done (audit #4)", async () => {
		const repo = new FakeSessionRepo();
		repo.insert(makeRecord("s1", "thread-1"));
		const svc = makeService(
			repo,
			makeFakeClient({
				runId: "run-s1",
				parts: [
					{ event: "messages", data: { type: "messages" } },
					{ event: "updates", data: { type: "updates" } },
				],
			}),
		);

		const order: string[] = [];
		const origPublish = streamBus.publish.bind(streamBus);
		streamBus.publish = ((
			sessionId: string,
			runId: string,
			type: string,
			data: unknown,
		) => {
			order.push(`publish:${type}`);
			return origPublish(sessionId, runId, type, data);
		}) as typeof streamBus.publish;
		const origSetResult = repo.setResult.bind(repo);
		repo.setResult = ((id: string, result: unknown, at: number) => {
			order.push("setResult");
			origSetResult(id, result, at);
		}) as typeof repo.setResult;

		const done = waitForEvent((e) => e.sessionId === "s1" && e.type === "done");
		const result = await svc.startRun("s1", "hello", configDir);
		const doneEvent = await done;

		expect(result).toEqual({ runId: "run-s1", status: "running" });
		expect(doneEvent.runId).toBe("run-s1");
		expect(repo.get("s1")?.status).toBe("completed");
		expect(order).toContain("setResult");
		expect(order.indexOf("publish:done")).toBeGreaterThan(
			order.indexOf("setResult"),
		);
	});

	test("cancel-shaped stream error → cancelled envelope + status (audit #9)", async () => {
		const repo = new FakeSessionRepo();
		repo.insert(makeRecord("s1", "thread-1"));
		const svc = makeService(
			repo,
			makeFakeClient({
				runId: "run-cancel",
				joinStream: async function* () {
					throw new Error("Run cancelled by user");
				},
			}),
		);

		const cancelled = waitForEvent(
			(e) => e.sessionId === "s1" && e.type === "cancelled",
		);
		await svc.startRun("s1", "hello", configDir);
		const ev = await cancelled;

		expect(ev.runId).toBe("run-cancel");
		expect(repo.get("s1")?.status).toBe("cancelled");
	});

	test("generic stream error → error envelope + persisted error", async () => {
		const repo = new FakeSessionRepo();
		repo.insert(makeRecord("s1", "thread-1"));
		const svc = makeService(
			repo,
			makeFakeClient({
				runId: "run-err",
				joinStream: async function* () {
					throw new Error("boom");
				},
			}),
		);

		const error = waitForEvent(
			(e) => e.sessionId === "s1" && e.type === "error",
		);
		await svc.startRun("s1", "hello", configDir);
		const ev = await error;

		expect((ev.data as { error: string }).error).toContain("boom");
		expect(repo.get("s1")?.status).toBe("error");
		expect(repo.get("s1")?.error).toContain("boom");
	});
});