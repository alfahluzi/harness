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
import { loadSessionManagerTools } from "./mcp-client.js";

/**
 * Filter a tool list by allow/deny rules (matched against `tool.name`).
 *
 * Rules:
 * - `allow` empty/undefined → all tools pass (subject to `deny`).
 * - `allow` non-empty → only names in allow pass.
 * - `deny` always wins over allow.
 * - Matching is exact string; wildcards intentionally NOT supported (keeps
 *   semantics predictable — a rename in a tool factory is a breaking change
 *   the agent should notice, not silently absorb via a glob).
 */
export function filterTools(
	tools: StructuredTool[],
	allow?: string[],
	deny?: string[],
): StructuredTool[] {
	const allowSet = allow && allow.length > 0 ? new Set(allow) : null;
	const denySet = deny && deny.length > 0 ? new Set(deny) : null;
	return tools.filter((t) => {
		if (denySet?.has(t.name)) return false;
		if (allowSet && !allowSet.has(t.name)) return false;
		return true;
	});
}

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
export function getAllTools(
	config: ToolsConfig,
	opts?: { allow?: string[]; deny?: string[] },
): StructuredTool[] {
	const tools: StructuredTool[] = [upsertMemoryTool];

	if (config.shell !== undefined) {
		tools.push(createShellTool(config.shell));
	}

	tools.push(...createFileTools(config.file));
	tools.push(createHttpTools(config.http));
	tools.push(...createSqlTools(config.sql));

	return filterTools(tools, opts?.allow, opts?.deny);
}

/**
 * Same as `getAllTools(config)` but also loads the session-manager MCP tools
 * from the backend `/mcp` endpoint. Async because it performs an MCP
 * handshake. Call once at graph build time, not per-invocation.
 */
export async function getAllToolsAsync(
	config: ToolsConfig,
	opts?: { allow?: string[]; deny?: string[] },
): Promise<StructuredTool[]> {
	const local = getAllTools(config, opts);
	const sessionTools = await loadSessionManagerTools();
	const filteredSession = filterTools(sessionTools, opts?.allow, opts?.deny);
	return [...local, ...filteredSession];
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
