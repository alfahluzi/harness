import type { Database, Statement } from "bun:sqlite";
import { sqliteDb } from "../../global/db";
import { GLOBAL_WORKSPACE_ID } from "../../models/providers";

export interface ProviderModelRecord {
	workspaceId: string;
	providerId: string;
	modelId: string;
	name: string | null;
	createdAt: number;
}

interface ProviderModelRow {
	workspace_id: string;
	provider_id: string;
	model_id: string;
	name: string | null;
	created_at: number;
}

interface Stmts {
	replaceAll: Statement;
	listByProvider: Statement;
	listByModel: Statement;
	countByProvider: Statement;
	deleteByProvider: Statement;
}

function prepare(db: Database): Stmts {
	return {
		replaceAll: db.prepare(`
			INSERT INTO provider_models (workspace_id, provider_id, model_id, name, created_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(workspace_id, provider_id, model_id)
			DO UPDATE SET name = excluded.name
		`),
		listByProvider: db.prepare(`
			SELECT workspace_id, provider_id, model_id, name, created_at
			  FROM provider_models
			 WHERE workspace_id = ? AND provider_id = ?
			 ORDER BY model_id ASC
		`),
		listByModel: db.prepare(`
			SELECT DISTINCT provider_id
			  FROM provider_models
			 WHERE workspace_id = ? AND model_id = ?
			 ORDER BY provider_id ASC
		`),
		countByProvider: db.prepare(`
			SELECT COUNT(*) AS count
			  FROM provider_models
			 WHERE workspace_id = ? AND provider_id = ?
		`),
		deleteByProvider: db.prepare(
			`DELETE FROM provider_models WHERE workspace_id = ? AND provider_id = ?`,
		),
	};
}

export class ProviderModelRepository {
	private stmts: Stmts;

	constructor(db: Database = sqliteDb) {
		this.stmts = prepare(db);
	}

	replaceAll(
		workspaceId: string,
		providerId: string,
		models: Array<{ modelId: string; name: string | null }>,
		createdAt: number,
	): void {
		// Cascade via FK would also clear the rows when the parent is deleted,
		// but a plain DELETE is cheaper and keeps the same intent visible here.
		this.stmts.deleteByProvider.run(workspaceId, providerId);
		for (const m of models) {
			this.stmts.replaceAll.run(workspaceId, providerId, m.modelId, m.name, createdAt);
		}
	}

	listByProvider(workspaceId: string, providerId: string): ProviderModelRecord[] {
		return (this.stmts.listByProvider.all(workspaceId, providerId) as ProviderModelRow[]).map(
			(row) => ({
				workspaceId: row.workspace_id,
				providerId: row.provider_id,
				modelId: row.model_id,
				name: row.name,
				createdAt: row.created_at,
			}),
		);
	}

	/**
	 * All (workspace, provider) pairs that expose `modelId`, local rows before
	 * global rows so callers can apply local-wins without re-sorting.
	 */
	listProvidersByModel(
		workspaceId: string,
		modelId: string,
	): Array<{ workspaceId: string; providerId: string }> {
		const localRows = this.stmts.listByModel.all(workspaceId, modelId) as Array<{
			provider_id: string;
		}>;
		const globalRows = this.stmts.listByModel.all(
			GLOBAL_WORKSPACE_ID,
			modelId,
		) as Array<{ provider_id: string }>;
		return [
			...localRows.map((r) => ({ workspaceId, providerId: r.provider_id })),
			...globalRows.map((r) => ({
				workspaceId: GLOBAL_WORKSPACE_ID,
				providerId: r.provider_id,
			})),
		];
	}

	countByProvider(workspaceId: string, providerId: string): number {
		const row = this.stmts.countByProvider.get(workspaceId, providerId) as
			| { count: number }
			| null;
		return row?.count ?? 0;
	}

	deleteByProvider(workspaceId: string, providerId: string): void {
		this.stmts.deleteByProvider.run(workspaceId, providerId);
	}
}
