import type { Database, Statement } from "bun:sqlite";
import { sqliteDb } from "../../global/db";

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
			INSERT INTO sessions (
				id, description, parent_thread_id, child_thread_id, run_id,
				agent_profile, background, status, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`),
		get: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
		list: db.prepare(`
			SELECT * FROM sessions ORDER BY created_at DESC
		`),
		listByParent: db.prepare(`
			SELECT * FROM sessions WHERE parent_thread_id = ?
		`),
		setStatus: db.prepare(`
			UPDATE sessions SET status = ? WHERE id = ?
		`),
		setRunId: db.prepare(`
			UPDATE sessions SET run_id = ? WHERE id = ?
		`),
		setResult: db.prepare(`
			UPDATE sessions
			   SET status = 'completed', result_json = ?, completed_at = ?
			 WHERE id = ?
		`),
		setError: db.prepare(`
			UPDATE sessions
			   SET status = 'error', error = ?, completed_at = ?
			 WHERE id = ?
		`),
		delete: db.prepare(`DELETE FROM sessions WHERE id = ?`),
	};
}

export class TaskNotFoundError extends Error {
	constructor(id: string) {
		super(`Task not found: ${id}`);
	}
}

export class TaskRepository {
	private stmts: Stmts;

	constructor(db: Database = sqliteDb) {
		this.stmts = prepare(db);
	}

	insert(task: TaskRecord): void {
		this.stmts.insert.run(
			task.id,
			task.description,
			task.parentThreadId ?? null,
			task.childThreadId,
			task.runId,
			task.agentProfile,
			task.background ? 1 : 0,
			task.status,
			task.createdAt,
		);
	}

	get(id: string): TaskRecord | null {
		const row = this.stmts.get.get(id) as TaskRow | null;
		return row ? rowToRecord(row) : null;
	}

	getOrThrow(id: string): TaskRecord {
		const row = this.stmts.get.get(id) as TaskRow | null;
		if (!row) throw new TaskNotFoundError(id);
		return rowToRecord(row);
	}

	list(): TaskRow[] {
		return this.stmts.list.all() as TaskRow[];
	}

	listByParent(parentThreadId: string): TaskRecord[] {
		return (this.stmts.listByParent.all(parentThreadId) as TaskRow[]).map(rowToRecord);
	}

	setStatus(id: string, status: TaskStatus): void {
		this.stmts.setStatus.run(status, id);
	}

	setRunId(id: string, runId: string): void {
		this.stmts.setRunId.run(runId, id);
	}

	setResult(id: string, result: unknown, completedAt: number): void {
		this.stmts.setResult.run(JSON.stringify(result), completedAt, id);
	}

	setError(id: string, error: string, completedAt: number): void {
		this.stmts.setError.run(error, completedAt, id);
	}

	delete(id: string): void {
		this.stmts.delete.run(id);
	}

	getRunningTasks(): TaskRecord[] {
		return this.list()
			.filter((r) => r.status === "running")
			.map(rowToRecord);
	}
}
