import {
	execFile,
	type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
	DEFAULT_OUTPUT_LIMIT_BYTES,
	DEFAULT_TIMEOUT_MS,
	logTool,
	toolError,
	truncate,
	withToolLog,
} from "./_lib.js";

/** Default commands the shell tool is allowed to run. */
export const DEFAULT_SHELL_ALLOWED_COMMANDS = ["git", "ls", "cat", "npm"];

/**
 * Upper bound for buffered stdout/stderr captured by execFile. Truncation for
 * display happens afterwards, but this keeps a runaway process from holding
 * unbounded memory in the buffer.
 */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export interface ShellToolConfig {
	allowedCommands: string[];
	cwd: string;
	timeoutMs?: number;
	outputLimitBytes?: number;
}

export const shellToolSchema = z.object({ command: z.string() });

/**
 * Shell metacharacters that defeat argv-tokenized (shell-free) execution.
 * Ordered most-specific-first so the reported culprit is the exact token.
 */
const FORBIDDEN_PATTERNS: Array<{ needle: string; label: string }> = [
	{ needle: "&&", label: "'&&'" },
	{ needle: "||", label: "'||'" },
	{ needle: "$(", label: "'$('" },
	{ needle: ";", label: "';'" },
	{ needle: "|", label: "'|'" },
	{ needle: "`", label: "backtick ('`')" },
	{ needle: ">", label: "'>'" },
	{ needle: "<", label: "'<'" },
];

/**
 * Find the first forbidden metacharacter in a command, or null if clean.
 * Returns a human-readable label naming the offending token.
 */
function findMetacharacter(command: string): string | null {
	for (const { needle, label } of FORBIDDEN_PATTERNS) {
		if (command.includes(needle)) {
			return label;
		}
	}
	return null;
}

/**
 * Tokenize a command string into argv without a shell. Splits on whitespace
 * and strips simple `"..."` and `'...'` quoted segments so args containing
 * spaces survive as a single token.
 */
function tokenizeCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let inToken = false;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote !== null) {
			if (ch === quote) {
				quote = null;
			} else {
				current += ch;
			}
		} else if (ch === "'" || ch === '"') {
			quote = ch;
			inToken = true;
		} else if (ch === " " || ch === "\t" || ch === "\n") {
			if (inToken) {
				tokens.push(current);
				current = "";
				inToken = false;
			}
		} else {
			current += ch;
			inToken = true;
		}
	}
	if (inToken) {
		tokens.push(current);
	}
	return tokens;
}

/** True if the error is an AbortError (fires when the timeout signal aborts). */
function isAbortError(err: unknown): boolean {
	return (
		err instanceof Error &&
		(err.name === "AbortError" ||
			(err as { code?: string }).code === "ABORT_ERR")
	);
}

/**
 * Execute a single command with execFile (never exec, never shell:true).
 * Resolves with the captured output and numeric exit code. Non-zero exits are
 * treated as data (so the LLM sees stdout/stderr/exit code). Rejects only on
 * timeout (AbortError) or spawn-level failures (command not found, etc).
 */
function runCommand(
	command: string,
	argv: string[],
	opts: { cwd: string; signal: AbortSignal },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const options = {
			cwd: opts.cwd,
			signal: opts.signal,
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
			maxBuffer: MAX_BUFFER_BYTES,
		} as unknown as ExecFileOptionsWithStringEncoding;

		execFile(command, argv, options, (error, stdout, stderr) => {
			if (error) {
				const err = error as NodeJS.ErrnoException & {
					code?: number | string;
				};
				if (err.name === "AbortError" || err.code === "ABORT_ERR") {
					reject(error);
					return;
				}
				if (typeof err.code === "number") {
					// Command ran but exited non-zero — surface output + exit code.
					resolve({ stdout, stderr, code: err.code });
					return;
				}
				reject(error);
				return;
			}
			resolve({ stdout, stderr, code: 0 });
		});
	});
}

/** Render stdout, stderr (if any), and exit code as a readable block. */
function formatResult(
	stdout: string,
	stderr: string,
	code: number | null,
	outputLimitBytes: number,
): string {
	const lines: string[] = [];
	if (stdout) {
		lines.push(`stdout:\n${truncate(stdout, outputLimitBytes)}`);
	}
	if (stderr) {
		lines.push(`stderr:\n${truncate(stderr, outputLimitBytes)}`);
	}
	lines.push(`exit code: ${code}`);
	return lines.join("\n\n");
}

async function runShell(
	input: { command: string },
	config: {
		allowedCommands: string[];
		cwd: string;
		timeoutMs: number;
		outputLimitBytes: number;
	},
): Promise<string> {
	const raw = input.command.trim();

	if (raw === "") {
		return toolError("shell", "empty command");
	}

	const meta = findMetacharacter(raw);
	if (meta !== null) {
		return toolError(
			"shell",
			`command contains forbidden metacharacter ${meta}`,
		);
	}

	const argv = tokenizeCommand(raw);
	const cmd = argv[0];
	if (!config.allowedCommands.includes(cmd)) {
		return toolError(
			"shell",
			`command '${cmd}' is not in the allowed whitelist [${config.allowedCommands.join(
				", ",
			)}]`,
		);
	}

	const args = argv.slice(1);

	try {
		return await withToolLog("shell", { command: raw }, async () => {
			const { stdout, stderr, code } = await runCommand(cmd, args, {
				cwd: config.cwd,
				signal: AbortSignal.timeout(config.timeoutMs),
			});
			return formatResult(stdout, stderr, code, config.outputLimitBytes);
		});
	} catch (err) {
		if (isAbortError(err)) {
			return `[shell] error: command timed out after ${config.timeoutMs} ms`;
		}
		const msg = err instanceof Error ? err.message : String(err);
		logTool("error", { tool: "shell", event: "rejected", error: msg });
		return toolError("shell", msg);
	}
}

/**
 * Build a shell tool bound to a fixed config (constructor-bound, no runtime
 * injection). Returns a ready-to-register LangChain tool.
 */
export function createShellTool(config: Partial<ShellToolConfig> = {}) {
	const allowedCommands =
		config.allowedCommands ?? DEFAULT_SHELL_ALLOWED_COMMANDS;
	const cwd = config.cwd ?? process.cwd();
	const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const outputLimitBytes =
		config.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;

	const impl = async (input: { command: string }): Promise<string> =>
		runShell(input, { allowedCommands, cwd, timeoutMs, outputLimitBytes });

	return tool(impl, {
		name: "shell",
		description: `Run a single command in a restricted, non-interactive sandbox. The command is tokenized into argv (no shell is invoked), so shell features like pipes, redirects, variable expansion, and command chaining are NOT supported and will be rejected. The first token must be one of the allowed commands: ${allowedCommands.join(
			", ",
		)}. Any command containing a shell metacharacter (; && || | \` $( > <) is rejected before execution. Examples: "git status", "ls -la", "cat package.json". Returns stdout, stderr (if any), and the exit code.`,
		schema: shellToolSchema,
	});
}

/** Default shell tool instance, bound to the default whitelist and cwd. */
export const shellTool = createShellTool();
