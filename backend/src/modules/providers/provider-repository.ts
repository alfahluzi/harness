import type { Database, Statement } from "bun:sqlite";
import { sqliteDb } from "../../global/db";
import { GLOBAL_WORKSPACE_ID } from "../../models/providers";

export type ProviderSource = "local" | "global";

export interface ProviderRecord {
	id: string;
	workspaceId: string;
	type: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	defaultModel: string;
	createdAt: number;
	updatedAt: number;
}

export interface ProviderSourceRecord extends ProviderRecord {
	source: ProviderSource;
}

interface ProviderRow {
	id: string;
	workspace_id: string;
	type: string;
	name: string;
	base_url: string;
	api_key: string;
	default_model: string;
	created_at: number;
	updated_at: number;
}

function rowToRecord(row: ProviderRow): ProviderRecord {
	return {
		id: row.id,
		workspaceId: row.workspace_id,
		type: row.type,
		name: row.name,
		baseUrl: row.base_url,
		apiKey: row.api_key,
		defaultModel: row.default_model,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

interface Stmts {
	insert: Statement;
	get: Statement;
	listForWorkspace: Statement;
	listGlobal: Statement;
	update: Statement;
	delete: Statement;
	countByKind: Statement;
}

function prepare(db: Database): Stmts {
	return {
		insert: db.prepare(`
			INSERT INTO providers (
				id, workspace_id, type, name, base_url, api_key, default_model,
				created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`),
		// Composite lookup keyed by (id, workspace_id). The API only ever
		// resolves a provider by id within a known workspace scope, so this
		// matches the PK exactly.
		get: db.prepare(`
			SELECT id, workspace_id, type, name, base_url, api_key, default_model,
			       created_at, updated_at
			  FROM providers
			 WHERE id = ? AND workspace_id = ?
		`),
		// Pull all rows visible to a workspace (its own + the global sentinel).
		// Local-vs-global dedupe happens in the service layer.
		listForWorkspace: db.prepare(`
			SELECT id, workspace_id, type, name, base_url, api_key, default_model,
			       created_at, updated_at
			  FROM providers
			 WHERE workspace_id = ? OR workspace_id = ?
			 ORDER BY id ASC
		`),
		listGlobal: db.prepare(`
			SELECT id, workspace_id, type, name, base_url, api_key, default_model,
			       created_at, updated_at
			  FROM providers
			 WHERE workspace_id = ?
			 ORDER BY id ASC
		`),
		update: db.prepare(`
			UPDATE providers
			   SET name = ?,
			       base_url = ?,
			       api_key = ?,
			       default_model = ?,
			       updated_at = ?
			 WHERE id = ? AND workspace_id = ?
		`),
		delete: db.prepare(`
			DELETE FROM providers WHERE id = ? AND workspace_id = ?
		`),
		// Pre-flight check for connect(): "is there already a local OR global
		// row of this kind?" — kept as one query so the service can short-circuit
		// the insert without a separate read.
		countByKind: db.prepare(`
			SELECT COUNT(*) AS count
			  FROM providers
			 WHERE id = ?
			   AND (workspace_id = ? OR workspace_id = ?)
		`),
	};
}

export class ProviderRepository {
	private stmts: Stmts;

	constructor(db: Database = sqliteDb) {
		this.stmts = prepare(db);
	}

	insert(rec: ProviderRecord): void {
		this.stmts.insert.run(
			rec.id,
			rec.workspaceId,
			rec.type,
			rec.name,
			rec.baseUrl,
			rec.apiKey,
			rec.defaultModel,
			rec.createdAt,
			rec.updatedAt,
		);
	}

	get(id: string, workspaceId: string): ProviderRecord | null {
		const row = this.stmts.get.get(id, workspaceId) as ProviderRow | null;
		return row ? rowToRecord(row) : null;
	}

	/**
	 * Return all rows visible to a workspace (its own locals + the global
	 * sentinel). Caller is responsible for the local-over-global merge.
	 */
	listForWorkspace(workspaceId: string): ProviderRecord[] {
		return (this.stmts.listForWorkspace.all(
			workspaceId,
			GLOBAL_WORKSPACE_ID,
		) as ProviderRow[]).map(rowToRecord);
	}

	listGlobal(): ProviderRecord[] {
		return (this.stmts.listGlobal.all(GLOBAL_WORKSPACE_ID) as ProviderRow[]).map(
			rowToRecord,
		);
	}

	update(rec: ProviderRecord): void {
		this.stmts.update.run(
			rec.name,
			rec.baseUrl,
			rec.apiKey,
			rec.defaultModel,
			rec.updatedAt,
			rec.id,
			rec.workspaceId,
		);
	}

	delete(id: string, workspaceId: string): void {
		this.stmts.delete.run(id, workspaceId);
	}

	/**
	 * Returns true if a provider of `id` already exists in either the local
	 * workspace scope OR the global scope — i.e. the caller should refuse to
	 * insert a duplicate (mirrors the pre-DB `mergeLayered` rule).
	 */
	existsInScope(id: string, workspaceId: string): boolean {
		const row = this.stmts.countByKind.get(id, workspaceId, GLOBAL_WORKSPACE_ID) as
			| { count: number }
			| null;
		return (row?.count ?? 0) > 0;
	}
}
