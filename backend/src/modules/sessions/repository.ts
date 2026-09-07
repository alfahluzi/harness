import type { Database, Statement } from "bun:sqlite";
import { sqliteDb } from "../../global/db";

export type SessionStatus =
	| "pending"
	| "running"
	| "completed"
	| "error"
	| "cancelled";

export interface SessionRecord {
	id: string;
	workspaceId: string;
	description: string;
	parentThreadId?: string;
	childThreadId: string;
	runId: string;
	agentProfile: string;
	background: boolean;
	status: SessionStatus;
	createdAt: number;
	completedAt?: number;
	result?: unknown;
	error?: string;
}

interface SessionRow {
	id: string;
	workspace_id: string;
	description: string;
	parent_thread_id: string | null;
	child_thread_id: string;
	run_id: string | null;
	agent_profile: string;
	background: number;
	status: SessionStatus;
	created_at: number;
	completed_at: number | null;
	result_json: string | null;
	error: string | null;
}

function rowToRecord(row: SessionRow): SessionRecord {
	return {
		id: row.id,
		workspaceId: row.workspace_id,
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
	listByWorkspace: Statement;
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
				id, workspace_id, description, parent_thread_id, child_thread_id, run_id,
				agent_profile, background, status, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`),
		get: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
		list: db.prepare(`
			SELECT * FROM sessions ORDER BY created_at DESC
		`),
		listByWorkspace: db.prepare(`
			SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC
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

export class SessionNotFoundError extends Error {
	constructor(id: string) {
		super(`Session not found: ${id}`);
	}
}

export class SessionRepository {
	private stmts: Stmts;

	constructor(db: Database = sqliteDb) {
		this.stmts = prepare(db);
	}

	insert(session: SessionRecord): void {
		this.stmts.insert.run(
			session.id,
			session.workspaceId,
			session.description,
			session.parentThreadId ?? null,
			session.childThreadId,
			session.runId,
			session.agentProfile,
			session.background ? 1 : 0,
			session.status,
			session.createdAt,
		);
	}

	get(id: string): SessionRecord | null {
		const row = this.stmts.get.get(id) as SessionRow | null;
		return row ? rowToRecord(row) : null;
	}

	getOrThrow(id: string): SessionRecord {
		const row = this.stmts.get.get(id) as SessionRow | null;
		if (!row) throw new SessionNotFoundError(id);
		return rowToRecord(row);
	}

	list(): SessionRecord[] {
		return (this.stmts.list.all() as SessionRow[]).map(rowToRecord);
	}

	listByWorkspace(workspaceId: string): SessionRecord[] {
		return (this.stmts.listByWorkspace.all(workspaceId) as SessionRow[]).map(
			rowToRecord,
		);
	}

	listByParent(parentThreadId: string): SessionRecord[] {
		return (this.stmts.listByParent.all(parentThreadId) as SessionRow[]).map(
			rowToRecord,
		);
	}

	setStatus(id: string, status: SessionStatus): void {
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

	getRunningSessions(): SessionRecord[] {
		return this.list().filter((r) => r.status === "running");
	}
}
