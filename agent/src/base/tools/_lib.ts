/**
 * Shared utilities for custom LangChain.js tools.
 *
 * - Structured JSON-line logger (no external deps).
 * - Output truncation with explicit marker so the LLM never sees a silent
 *   partial read.
 * - Default size/timeout constants used across tools.
 */
import { Buffer } from "node:buffer";

/** Default output cap for tool results, in bytes. Override per-tool if needed. */
export const DEFAULT_OUTPUT_LIMIT_BYTES = 6 * 1024;

/** Default subprocess / network / query timeout, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Default max rows for SQL queries. */
export const DEFAULT_MAX_ROWS = 200;

/** Default max file size for reads/writes, in bytes (1 MB). */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export interface LogContext {
	/** Tool name, e.g. "shell". */
	tool: string;
	/** Free-form key/value bag (input summary, duration, exit code). */
	[key: string]: unknown;
}

export type LogLevel = "info" | "warn" | "error";

/**
 * Emit a single structured JSON line. Cheap, no deps, easy to grep in CI logs.
 * Avoid logging full input/output verbatim — callers should pre-truncate.
 */
export function logTool(level: LogLevel, ctx: LogContext): void {
	const line = JSON.stringify({
		t: new Date().toISOString(),
		level,
		...ctx,
	});
	// info → stdout, warn/error → stderr so they can be routed separately.
	if (level === "info") {
		console.log(line);
	} else {
		console.error(line);
	}
}

/**
 * Truncate a string/Buffer to at most `maxBytes`, appending a clear marker so
 * the LLM knows the response was cut off. Never silently drops data.
 */
export function truncate(value: string | Buffer, maxBytes: number): string {
	const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
	if (buf.byteLength <= maxBytes) {
		return buf.toString("utf8");
	}
	const cut = buf.subarray(0, maxBytes).toString("utf8");
	const dropped = buf.byteLength - maxBytes;
	return (
		cut +
		`\n\n[truncated: ${dropped} byte(s) omitted, original length ${buf.byteLength} byte(s)]`
	);
}

/**
 * Truncate the JSON-serialised form of a value (object, array, etc) so the
 * tool result string stays bounded.
 */
export function truncateJson(value: unknown, maxBytes: number): string {
	try {
		return truncate(JSON.stringify(value, null, 2), maxBytes);
	} catch {
		// circular refs etc — fall back to a safe representation
		return truncate(String(value), maxBytes);
	}
}

/**
 * Time an async operation and return its result + elapsed ms. Logs a single
 * INFO line on success and a WARN/ERROR line on throw, via the shared logger.
 */
export async function withToolLog<T>(
	tool: string,
	input: unknown,
	fn: () => Promise<T>,
): Promise<T> {
	const start = Date.now();
	const inputSummary = truncateJson(input, 1024);
	try {
		const out = await fn();
		logTool("info", {
			tool,
			event: "complete",
			input: inputSummary,
			elapsedMs: Date.now() - start,
			ok: true,
		});
		return out;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logTool("error", {
			tool,
			event: "error",
			input: inputSummary,
			elapsedMs: Date.now() - start,
			error: msg,
		});
		throw err;
	}
}

/**
 * Standard error format returned to the LLM as a string. Tools catch their
 * own exceptions and return these messages instead of throwing — keeps the
 * agent loop alive and lets the model react/retry.
 */
export function toolError(tool: string, message: string): string {
	return `[${tool}] error: ${message}`;
}
