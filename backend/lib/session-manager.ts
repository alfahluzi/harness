import { Database, type Statement } from "bun:sqlite";
import { Client } from "@langchain/langgraph-sdk";
import { config } from "./config";
import { db } from "./db";

export type TaskStatus = "pending" | "running" | "completed" | "error" | "cancelled";

export interface TaskRecord {
	id: string;
	description: string;
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

interface TaskRow {
	id: string;
	description: string;
	parent_thread_id: string | null;
	child_thread_id: string;
	run_id: string | null;
	agent_profile: string;
	background: number;
	status: TaskStatus;
	created_at: number;
	completed_at: number | null;
	result_json: string | null;
	error: string | null;
}

function rowToRecord(row: TaskRow): TaskRecord {
	return {
		id: row.id,
		description: row.description,
		parentThreadId: row.parent_thread_id ?? undefined,
		childThreadId: row.child_thread_id,
		runId: row.run_id ?? "",
		agentProfile: row.agent_profile,
		background: row.background === 1,
		status: row.status,
		createdAt: row.created_at,
		completedAt: row.completed_at ?? undefined,
		result: row.result_json ? JSON.parse(row.result_json) : undefined,
		error: row.error ?? undefined,
	};
}

export class TaskNotFoundError extends Error {
	constructor(id: string) {
		super(`Task not found: ${id}`);
	}
}

interface Stmts {
	insert: Statement;
	get: Statement;
	list: Statement;
	listByParent: Statement;
	setStatus: Statement;
	setRunId: Statement;
	setResult: Statement;
	setError: Statement;
	delete: Statement;
}

function prepare(db: Database): Stmts {
	return {
		insert: db.prepare(`
			INSERT INTO tasks (
				id, description, parent_thread_id, child_thread_id, run_id,
				agent_profile, background, status, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`),
		get: db.prepare(`SELECT * FROM tasks WHERE id = ?`),
		list: db.prepare(`
			SELECT * FROM tasks ORDER BY created_at DESC
		`),
		listByParent: db.prepare(`
			SELECT * FROM tasks WHERE parent_thread_id = ?
		`),
		setStatus: db.prepare(`
			UPDATE tasks SET status = ? WHERE id = ?
		`),
		setRunId: db.prepare(`
			UPDATE tasks SET run_id = ? WHERE id = ?
		`),
		setResult: db.prepare(`
			UPDATE tasks
			   SET status = 'completed', result_json = ?, completed_at = ?
			 WHERE id = ?
		`),
		setError: db.prepare(`
			UPDATE tasks
			   SET status = 'error', error = ?, completed_at = ?
			 WHERE id = ?
		`),
		delete: db.prepare(`DELETE FROM tasks WHERE id = ?`),
	};
}

export class SessionManager {
	private client: Client;
	private stmts: Stmts;
	/** Per-agent-profile concurrency counters (runtime only, not persisted). */
	private activeCount = new Map<string, number>();

	constructor() {
		this.client = new Client({ apiUrl: config.langgraphUrl });
		this.stmts = prepare(db);
	}

	async create(opts: {
		parent?: string;
		description: string;
		prompt: string;
		agentProfile: string;
		background: boolean;
	}) {
		const child = await this.client.threads.create();
		const taskId = `bg_${crypto.randomUUID().slice(0, 8)}`;
		const createdAt = Date.now();

		this.stmts.insert.run(
			taskId,
			opts.description,
			opts.parent ?? null,
			child.thread_id,
			"",
			opts.agentProfile,
			opts.background ? 1 : 0,
			"pending",
			createdAt,
		);

		const record: TaskRecord = {
			id: taskId,
			description: opts.description,
			parentThreadId: opts.parent,
			childThreadId: child.thread_id,
			runId: "",
			agentProfile: opts.agentProfile,
			background: opts.background,
			status: "pending",
			createdAt,
		};

		if (!opts.background) {
			record.status = "running";
			this.stmts.setStatus.run("running", taskId);
			const run = await this.client.runs.wait(child.thread_id, config.graphId, {
				input: { messages: [{ role: "human", content: opts.prompt }] },
				config: { configurable: { agent_profile: opts.agentProfile } },
			});
			record.status = "completed";
			record.completedAt = Date.now();
			record.result = run;
			this.stmts.setResult.run(JSON.stringify(run), record.completedAt, taskId);
			return { taskId, sessionId: child.thread_id, status: record.status, result: run };
		}

		void this.launch(record, opts.prompt); // fire-and-forget
		return { taskId, sessionId: child.thread_id, status: record.status };
	}

	async list() {
		const rows = this.stmts.list.all() as TaskRow[];
		return rows.map((r) => ({
			id: r.id,
			description: r.description,
			status: r.status,
			agentProfile: r.agent_profile,
			createdAt: r.created_at,
			completedAt: r.completed_at ?? undefined,
		}));
	}

	private async launch(record: TaskRecord, prompt: string) {
		await this.acquireSlot(record.agentProfile);
		record.status = "running";
		this.stmts.setStatus.run("running", record.id);

		try {
			const run = await this.client.runs.create(record.childThreadId, config.graphId, {
				input: { messages: [{ role: "human", content: prompt }] },
				config: { configurable: { agent_profile: record.agentProfile } },
			});
			record.runId = run.run_id;
			this.stmts.setRunId.run(run.run_id, record.id);

			await this.waitForCompletion(record);

			const state = await this.client.threads.getState(record.childThreadId);
			record.status = "completed";
			record.completedAt = Date.now();
			record.result = state.values;
			this.stmts.setResult.run(JSON.stringify(state.values), record.completedAt, record.id);
		} catch (e) {
			record.status = "error";
			record.error = String(e);
			record.completedAt = Date.now();
			this.stmts.setError.run(String(e), record.completedAt, record.id);
		} finally {
			this.releaseSlot(record.agentProfile);
			if (record.parentThreadId) {
				await this.notifyParent(record).catch((e) =>
					console.error(`notifyParent failed for ${record.id}:`, e),
				);
			}
		}
	}

	private async waitForCompletion(record: TaskRecord) {
		try {
			for await (const _chunk of this.client.runs.joinStream(
				record.childThreadId,
				record.runId,
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

		const siblings = (
			this.stmts.listByParent.all(record.parentThreadId) as TaskRow[]
		).map(rowToRecord);

		const siblingsStillRunning = siblings.some(
			(r) => r.id !== record.id && r.status === "running",
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
				: "All background tasks complete.",
		);
		lines.push(`Use get_result(id="${record.id}") to retrieve output.`);
		return lines.join("\n");
	}

	private fetchRecord(id: string): TaskRecord {
		const row = this.stmts.get.get(id) as TaskRow | null;
		if (!row) throw new TaskNotFoundError(id);
		return rowToRecord(row);
	}

	async getStatus(id: string) {
		const r = this.fetchRecord(id);
		return { status: r.status, createdAt: r.createdAt, completedAt: r.completedAt };
	}

	async getResult(id: string) {
		const r = this.fetchRecord(id);
		if (r.status !== "completed" && r.status !== "error") return { status: r.status };
		return { status: r.status, result: r.result };
	}

	async sendMessage(id: string, message: string) {
		const r = this.fetchRecord(id);
		const run = await this.client.runs.wait(r.childThreadId, config.graphId, {
			input: { messages: [{ role: "human", content: message }] },
			config: { configurable: { agent_profile: r.agentProfile } },
		});
		this.stmts.setResult.run(JSON.stringify(run), Date.now(), id);
		return run;
	}

	async delete(id: string) {
		const r = this.fetchRecord(id);
		if (r.status === "running" && r.runId) {
			await this.client.runs.cancel(r.childThreadId, r.runId).catch(() => {});
		}
		await this.client.threads.delete(r.childThreadId).catch(() => {});
		this.stmts.delete.run(id);
	}

	private async acquireSlot(key: string) {
		const limit = config.maxConcurrency[key] ?? config.maxConcurrency.default ?? 3;
		while ((this.activeCount.get(key) ?? 0) >= limit) {
			await new Promise((r) => setTimeout(r, 500));
		}
		this.activeCount.set(key, (this.activeCount.get(key) ?? 0) + 1);
	}

	private releaseSlot(key: string) {
		this.activeCount.set(key, Math.max(0, (this.activeCount.get(key) ?? 1) - 1));
	}

	async cancelAll() {
		const rows = (this.stmts.list.all() as TaskRow[]).filter((r) => r.status === "running");
		await Promise.all(rows.map((r) => this.delete(r.id).catch(() => {})));
	}
}

export const sessionManager = new SessionManager();