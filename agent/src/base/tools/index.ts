/**
 * Aggregator for the custom sandboxed LangChain.js tools.
 *
 * Drop-in: `createReactAgent({ llm, tools: getAllTools(config) })`.
 *
 * Every tool is fail-closed: the caller MUST pass a config for each of
 * shell / file / http / sql. There are no "allow everything" defaults
 * (shell is omitted unless explicitly configured; file/http/sql throw at
 * construction if their required fields are missing).
 */
import type { StructuredTool } from "@langchain/core/tools";
import { upsertMemoryTool } from "./upsert-mem.js";
import { createShellTool, type ShellToolConfig } from "./shell-tool.js";
import { createFileTools, type FileToolsConfig } from "./file-tools.js";
import { createHttpTools, type HttpToolsConfig } from "./http-tools.js";
import { createSqlTools, type SqlToolsConfig } from "./sql-tools.js";

export interface ToolsConfig {
	/**
	 * If provided, the `shell` tool is included. Omit the key to leave shell
	 * access off entirely. Even when present, the inner factory rejects any
	 * command outside the whitelist and any shell metacharacter.
	 */
	shell?: Partial<ShellToolConfig>;
	/** Required. Sandboxed file tools (read/write/list/delete, readOnly-aware). */
	file: FileToolsConfig;
	/** Required. HTTP fetch with SSRF guard and host whitelist. */
	http: HttpToolsConfig;
	/** Required. Read-only SQL tools (SQLite via `node:sqlite`). */
	sql: SqlToolsConfig;
}

/**
 * Build the full tool set for a React agent. The `upsertMemoryTool` is always
 * included (it's a project-internal tool, not a sandboxed capability).
 *
 * @example
 * ```ts
 * import { getAllTools } from "./base/tools/index.js";
 * const tools = getAllTools({
 *   shell: { allowedCommands: ["git", "ls", "cat", "npm"], cwd: "/srv/repo" },
 *   file: { rootDir: "/srv/repo", readOnly: false },
 *   http: { allowedHosts: ["api.example.com"] },
 *   sql: { connectionString: ":memory:", allowedTables: ["users"] },
 * });
 * ```
 */
export function getAllTools(config: ToolsConfig): StructuredTool[] {
	const tools: StructuredTool[] = [upsertMemoryTool];

	if (config.shell !== undefined) {
		tools.push(createShellTool(config.shell));
	}

	tools.push(...createFileTools(config.file));
	tools.push(createHttpTools(config.http));
	tools.push(...createSqlTools(config.sql));

	return tools;
}

// Re-export the individual factories + config types so callers can build
// subsets (e.g. just the HTTP tool) without going through the aggregator.
export {
	createShellTool,
	shellTool,
	shellToolSchema,
	type ShellToolConfig,
	DEFAULT_SHELL_ALLOWED_COMMANDS,
} from "./shell-tool.js";

export {
	createFileTools,
	FileTools,
	readFileSchema,
	writeFileSchema,
	listDirectorySchema,
	deleteFileSchema,
	type FileToolsConfig,
} from "./file-tools.js";

export {
	createHttpTools,
	httpFetchSchema,
	type HttpToolsConfig,
} from "./http-tools.js";

export {
	createSqlTools,
	listTablesSchema,
	describeTableSchema,
	runQuerySchema,
	type SqlToolsConfig,
} from "./sql-tools.js";

export { upsertMemoryTool } from "./upsert-mem.js";

/**
 * Legacy flat list of the project-internal tools (no sandboxed capabilities).
 * Kept for back-compat with existing nodes (`call-llm.ts`, `call-tool.ts`).
 * New code should prefer `getAllTools(config)` to compose the full sandboxed
 * toolset explicitly.
 */
export const tools = [upsertMemoryTool];
