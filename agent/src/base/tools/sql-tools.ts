/**
 * Sandboxed read-only SQL tools for the agent (SQLite).
 *
 * Drop-in replacement for the sunset `@langchain/community` `SQLDatabaseToolkit`.
 * Uses the Node built-in `node:sqlite` driver (Node 22.5+/24) — no extra deps.
 *
 * Safety model (runQuery):
 *   - Statement-level guard: must start with SELECT/WITH, no stacked statements,
 *     no write/DDL keywords (keyword check only — see tool description).
 *   - Query-level guard: every execution happens inside BEGIN ... ROLLBACK, so
 *     even a mis-parse cannot persist writes. Read-only by construction.
 *   - Output bounded: auto-LIMIT to maxRows, then truncate to outputLimitBytes.
 *
 * NOTE: SQLite-only. For Postgres/MySQL swap the driver (prepare + all()) —
 * the rest of this file stays the same.
 *
 * NOTE: `timeoutMs` is accepted for config parity with the old toolkit, but a
 * synchronous SQLite call cannot be preempted on the same thread. Read-only
 * queries against local SQLite are fast; elapsed time is still logged via
 * withToolLog.
 */
import { tool, type StructuredTool } from "@langchain/core/tools";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
	DEFAULT_MAX_ROWS,
	DEFAULT_OUTPUT_LIMIT_BYTES,
	logTool,
	truncateJson,
	withToolLog,
	toolError,
} from "./_lib.js";

export const listTablesSchema = z.object({});
export const describeTableSchema = z.object({ tableName: z.string() });
export const runQuerySchema = z.object({ sql: z.string() });

export interface SqlToolsConfig {
	/** ":memory:" or a file path. */
	connectionString: string;
	/** If set, listTables/describeTable are filtered; runQuery is NOT table-scoped (see README limitation). */
	allowedTables?: string[];
	maxRows?: number; // default DEFAULT_MAX_ROWS (200)
	timeoutMs?: number; // default DEFAULT_TIMEOUT_MS (15000)
	outputLimitBytes?: number; // default DEFAULT_OUTPUT_LIMIT_BYTES (6144)
}

/**
 * Validate that a table name is a plain SQLite identifier so it can be safely
 * interpolated into `pragma table_info(...)`. SQLite identifiers cannot be
 * bound as parameters, so we reject anything that isn't `[A-Za-z_][A-Za-z0-9_]*`.
 */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Write/DDL/session keywords rejected anywhere in the original SQL. */
const BLOCKED_KEYWORDS =
	/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|REPLACE|MERGE|CALL|SET)\b/i;

const errMsg = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

/**
 * Create the SQLite-backed read-only SQL toolkit tools.
 *
 * Opens the DB at construction time (fail loud — an invalid connection string
 * is a misconfiguration, not a runtime error). For `:memory:` the handle is
 * per-instance: each call to `createSqlTools` gets its own DB.
 */
export function createSqlTools(config: SqlToolsConfig): StructuredTool[] {
	const db = new DatabaseSync(config.connectionString);
	const allowedTables = config.allowedTables;
	const maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;
	const outputLimitBytes =
		config.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
	// config.timeoutMs (default DEFAULT_TIMEOUT_MS) is accepted for parity with
	// the old toolkit but intentionally not enforced — a synchronous SQLite call
	// cannot be preempted on the same thread. See header note.

	/**
	 * Run a synchronous DB accessor inside BEGIN ... ROLLBACK. Always rolls
	 * back, even on success — defense in depth + idempotency.
	 */
	function inRolledBackTx<T>(fn: () => T): T {
		db.exec("BEGIN");
		try {
			const result = fn();
			db.exec("ROLLBACK");
			return result;
		} catch (e) {
			try {
				db.exec("ROLLBACK");
			} catch {
				// transaction may never have started — nothing to roll back
			}
			throw e;
		}
	}

	// ---------------------------------------------------------------------
	// 1. listTables
	// ---------------------------------------------------------------------
	const listTables = tool(
		async (): Promise<string> => {
			try {
				return await withToolLog("sql:listTables", {}, async () => {
					const rows = inRolledBackTx(() => {
						const stmt = db.prepare(
							"SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
						);
						return stmt.all() as Array<{
							name: string;
							type: string;
						}>;
					});
					const filtered = allowedTables
						? rows.filter((r) => allowedTables.includes(r.name))
						: rows;
					return truncateJson(filtered, outputLimitBytes);
				});
			} catch (e) {
				return toolError("sql:listTables", errMsg(e));
			}
		},
		{
			name: "listTables",
			description:
				"List tables/views in the database, optionally filtered to an allow-list.",
			schema: listTablesSchema,
		},
	);

	// ---------------------------------------------------------------------
	// 2. describeTable
	// ---------------------------------------------------------------------
	const describeTable = tool(
		async (input: { tableName: string }): Promise<string> => {
			try {
				return await withToolLog("sql:describeTable", input, async () => {
					const { tableName } = input;
					if (allowedTables && !allowedTables.includes(tableName)) {
						return toolError(
							"sql:describeTable",
							`table "${tableName}" is not in the allowed-tables list`,
						);
					}
					if (!PLAIN_IDENTIFIER.test(tableName)) {
						return toolError(
							"sql:describeTable",
							`table name "${tableName}" is not a plain SQLite identifier`,
						);
					}
					const cols = inRolledBackTx(() => {
						const stmt = db.prepare(`pragma table_info(${tableName})`);
						return stmt.all() as Array<{
							cid: number;
							name: string;
							type: string;
							notnull: number;
							dflt_value: unknown;
							pk: number;
						}>;
					});
					return truncateJson(cols, outputLimitBytes);
				});
			} catch (e) {
				return toolError("sql:describeTable", errMsg(e));
			}
		},
		{
			name: "describeTable",
			description:
				"Describe a table's columns. Rejects tables outside the allow-list.",
			schema: describeTableSchema,
		},
	);

	// ---------------------------------------------------------------------
	// 3. runQuery
	// ---------------------------------------------------------------------
	const runQuery = tool(
		async (input: { sql: string }): Promise<string> => {
			try {
				return await withToolLog("sql:runQuery", input, async () => {
					const { sql } = input;

					// 1. Strip /* */ block comments and -- line comments, then trim.
					const stripped = sql
						.replace(/\/\*[\s\S]*?\*\//g, "")
						.replace(/--[^\n]*/g, "")
						.trim();

					// 2. Must start with SELECT or WITH (case-insensitive).
					const head = stripped.split(/\s+/, 2).join(" ").toUpperCase();
					if (!head.startsWith("SELECT") && !head.startsWith("WITH")) {
						return toolError(
							"sql:runQuery",
							"only read-only SELECT/WITH queries are allowed",
						);
					}

					// 3. No semicolon followed by non-whitespace content
					//    (no stacked statements). Trailing ";" is tolerated.
					if (/;(?!\s*$)\s*\S/.test(stripped)) {
						return toolError(
							"sql:runQuery",
							"multi-statement SQL is not allowed",
						);
					}

					// 4. No write/DDL/session keywords ANYWHERE in the original
					//    sql (defense in depth). Known limitation: naive keyword
					//    regex, not a SQL parser — a keyword inside a string
					//    literal (e.g. name = 'DROP') false-positives and is
					//    rejected by design.
					if (BLOCKED_KEYWORDS.test(sql)) {
						return toolError(
							"sql:runQuery",
							"query contains a blocked keyword (write/DDL/session statement)",
						);
					}

					// Trailing semicolons are legal but would break appending
					// LIMIT, so strip them before building the final statement.
					const base = stripped.replace(/;+\s*$/, "");

					// 5. Auto-LIMIT when the query has no LIMIT clause.
					const finalSql = /\bLIMIT\b/i.test(base)
						? base
						: `${base} LIMIT ${maxRows}`;

					const rows = inRolledBackTx(() => {
						const stmt = db.prepare(finalSql);
						return stmt.all() as unknown[];
					});

					// Defensive cap even after LIMIT (e.g. an existing
					// "LIMIT 100000" in the user query).
					const capped = rows.slice(0, maxRows);
					return truncateJson(capped, outputLimitBytes);
				});
			} catch (e) {
				return toolError("sql:runQuery", errMsg(e));
			}
		},
		{
			name: "runQuery",
			description:
				"Run a single read-only SQL statement (SELECT/WITH only). Writes, DDL, \
				multi-statement, and blocked keywords are rejected. Results auto-limited and \
				always rolled back. Keyword-based check only; not a full SQL parser. Production \
				deployments should also use a DB user with SELECT-only grant.",
			schema: runQuerySchema,
		},
	);

	logTool("info", {
		tool: "sql",
		event: "init",
		connectionString: config.connectionString,
		allowedTables: allowedTables ?? [],
		maxRows,
		outputLimitBytes,
		ok: true,
	});

	return [listTables, describeTable, runQuery];
}
