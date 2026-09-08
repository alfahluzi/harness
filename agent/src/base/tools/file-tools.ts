/**
 * Sandboxed file tools for the agent.
 *
 * Drop-in replacement for the sunset `@langchain/community`
 * `FileManagementToolkit`.
 *
 * Safety model (every tool):
 *   - rootDir is validated at construction (must be absolute — fail loud).
 *   - Every requested path is resolved, then canonicalised with fs.realpath
 *     so symlinks cannot escape the sandbox, then verified to stay inside
 *     the canonicalised rootDir.
 *   - Reads/writes are bounded by maxFileSizeBytes (default 1 MB).
 *   - readOnly=true omits writeFile/deleteFile entirely (not "disabled").
 *   - Tool bodies never throw: failures are logged and returned via toolError.
 *
 * NOTE: config is constructor/factory-bound. No ToolRuntime.
 */
import { tool, type StructuredTool } from "@langchain/core/tools";
import { Buffer } from "node:buffer";
import { realpathSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
	DEFAULT_MAX_FILE_BYTES,
	DEFAULT_OUTPUT_LIMIT_BYTES,
	toolError,
	truncate,
	truncateJson,
	withToolLog,
} from "./_lib.js";

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

export interface FileToolsConfig {
	/** Absolute path to the sandbox root. Validated at construction. */
	rootDir: string;
	/** Default false. When true, writeFile/deleteFile are not constructed. */
	readOnly?: boolean;
	/** Max bytes for a single read/write. Default DEFAULT_MAX_FILE_BYTES (1 MB). */
	maxFileSizeBytes?: number;
	/** Cap on tool result strings. Default DEFAULT_OUTPUT_LIMIT_BYTES (6144). */
	outputLimitBytes?: number;
}

/* ------------------------------------------------------------------ */
/* Zod schemas                                                        */
/* ------------------------------------------------------------------ */

export const readFileSchema = z.object({
	path: z
		.string()
		.describe(
			"Path to a text file, relative to the sandbox root. " +
				"Examples: 'notes.txt', 'data/config.json'. " +
				"Must stay inside the sandbox root (no '..' escapes, no absolute paths).",
		),
});

export const writeFileSchema = z.object({
	path: z
		.string()
		.describe(
			"Path of the file to write, relative to the sandbox root. " +
				"Parent directories are created as needed. " +
				"Examples: 'notes.txt', 'subdir/new.txt'. " +
				"Must stay inside the sandbox root (no '..' escapes, no absolute paths).",
		),
	content: z
		.string()
		.describe(
			"UTF-8 text content to write. Must not exceed the sandbox size limit.",
		),
});

export const listDirectorySchema = z.object({
	path: z
		.string()
		.optional()
		.describe(
			"Directory to list, relative to the sandbox root. " +
				"Defaults to '.' (the sandbox root itself). " +
				"Examples: '.', 'data', 'src/components'.",
		),
});

export const deleteFileSchema = z.object({
	path: z
		.string()
		.describe(
			"Path of the file to delete, relative to the sandbox root. " +
				"Examples: 'notes.txt', 'tmp/old.txt'. " +
				"Must stay inside the sandbox root (no '..' escapes, no absolute paths).",
		),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

type ReadFileInput = z.infer<typeof readFileSchema>;
type WriteFileInput = z.infer<typeof writeFileSchema>;
type ListDirectoryInput = z.infer<typeof listDirectorySchema>;
type DeleteFileInput = z.infer<typeof deleteFileSchema>;

const errMsg = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

/**
 * Resolve `p` to a canonical path even when it (or an ancestor) does not
 * exist yet. realpathSync fails on missing paths, so walk up to the nearest
 * existing ancestor, canonicalise that, and re-append the missing tail.
 */
function canonicalize(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		const parent = path.dirname(p);
		if (parent === p) {
			return p;
		}
		return path.join(canonicalize(parent), path.basename(p));
	}
}

/* ------------------------------------------------------------------ */
/* Toolkit                                                            */
/* ------------------------------------------------------------------ */

export class FileTools {
	/** Absolute root as given (normalised) — used in messages/descriptions. */
	readonly rootDir: string;
	/** Canonical root (symlinks resolved) — used for containment checks. */
	readonly realRootDir: string;
	readonly readOnly: boolean;
	readonly maxFileSizeBytes: number;
	readonly outputLimitBytes: number;

	constructor(config: FileToolsConfig) {
		if (
			typeof config.rootDir !== "string" ||
			config.rootDir.length === 0 ||
			!path.isAbsolute(config.rootDir)
		) {
			throw new Error(
				`[FileTools] rootDir must be a non-empty absolute path. Received: ${JSON.stringify(
					config.rootDir,
				)}`,
			);
		}
		this.rootDir = path.resolve(config.rootDir);
		this.readOnly = config.readOnly === true;
		this.maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_BYTES;
		this.outputLimitBytes =
			config.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
		if (this.maxFileSizeBytes <= 0) {
			throw new Error(
				`[FileTools] maxFileSizeBytes must be > 0. Received: ${config.maxFileSizeBytes}`,
			);
		}
		if (this.outputLimitBytes <= 0) {
			throw new Error(
				`[FileTools] outputLimitBytes must be > 0. Received: ${config.outputLimitBytes}`,
			);
		}
		// Canonicalise once so containment checks compare against the real
		// root, not a possibly-symlinked spelling of it.
		this.realRootDir = canonicalize(this.rootDir);
	}

	/**
	 * Resolve a user-supplied path to a canonical path guaranteed to live
	 * inside the sandbox root. Throws (caller converts to toolError) when the
	 * path escapes the root — including via '..' segments, absolute paths, or
	 * symlinks pointing outside.
	 */
	private async resolveWithinRoot(
		requestedPath: string | undefined,
	): Promise<string> {
		const requested = requestedPath ?? ".";
		const resolved = path.resolve(this.realRootDir, requested);
		let real = resolved;
		try {
			// Target exists (read/list/delete, or write to an existing file).
			real = await realpath(resolved);
		} catch {
			// Target does not exist yet — canonicalise the parent dir instead.
			try {
				real = path.join(
					await realpath(path.dirname(resolved)),
					path.basename(resolved),
				);
			} catch {
				// Parent does not exist either (deep write into a brand-new
				// tree) — realpath is impossible; string containment only.
				real = resolved;
			}
		}
		const root = this.realRootDir;
		if (real !== root && !real.startsWith(root + path.sep)) {
			throw new Error(
				`path "${requested}" escapes the sandbox root "${this.rootDir}": ` +
					`it resolves to "${real}"`,
			);
		}
		return real;
	}

	/* ---------------- operations (throw; wrapper converts) ----------- */

	private async readFileOp(input: ReadFileInput): Promise<string> {
		const real = await this.resolveWithinRoot(input.path);
		const st = await stat(real);
		if (!st.isFile()) {
			throw new Error(`"${input.path}" is not a file`);
		}
		if (st.size > this.maxFileSizeBytes) {
			throw new Error(
				`file "${input.path}" is ${st.size} byte(s), which exceeds the ` +
					`${this.maxFileSizeBytes} byte(s) maximum allowed file size`,
			);
		}
		// Size check passed (file is <= maxFileSizeBytes); read fully, then cap
		// what the model actually sees at outputLimitBytes.
		const content = await readFile(real, "utf8");
		return truncate(content, this.outputLimitBytes);
	}

	private async writeFileOp(input: WriteFileInput): Promise<string> {
		const real = await this.resolveWithinRoot(input.path);
		const bytes = Buffer.byteLength(input.content, "utf8");
		if (bytes > this.maxFileSizeBytes) {
			throw new Error(
				`write of "${input.path}" is ${bytes} byte(s), which exceeds the ` +
					`${this.maxFileSizeBytes} byte(s) maximum allowed file size`,
			);
		}
		await mkdir(path.dirname(real), { recursive: true });
		await writeFile(real, input.content, "utf8");
		return `wrote ${bytes} byte(s) to ${real}`;
	}

	private async listDirectoryOp(input: ListDirectoryInput): Promise<string> {
		const real = await this.resolveWithinRoot(input.path);
		const dirents = await readdir(real, { withFileTypes: true });
		const entries: Array<{
			name: string;
			isFile: boolean;
			isDirectory: boolean;
			size?: number;
		}> = [];
		for (const d of dirents) {
			const entry = {
				name: d.name,
				isFile: d.isFile(),
				isDirectory: d.isDirectory(),
				size: undefined as number | undefined,
			};
			if (d.isFile()) {
				// Follow nothing: stat only real files so symlinks (which may
				// point outside the sandbox) never leak sizes.
				const st = await stat(path.join(real, d.name));
				entry.size = st.size;
			}
			entries.push(entry);
		}
		return truncateJson(entries, this.outputLimitBytes);
	}

	private async deleteFileOp(input: DeleteFileInput): Promise<string> {
		const real = await this.resolveWithinRoot(input.path);
		await unlink(real);
		return `deleted ${real}`;
	}

	/* ---------------- tool plumbing ------------------------------- */

	/**
	 * Shared body for every tool: log, run, and convert any throw into a
	 * toolError string. Tool bodies never throw.
	 */
	private async runTool(
		name: string,
		input: unknown,
		fn: () => Promise<string>,
	): Promise<string> {
		try {
			return await withToolLog(name, input, fn);
		} catch (err) {
			return toolError(name, errMsg(err));
		}
	}

	/* ---------------- individual tools ----------------------------- */

	readFileTool(): StructuredTool {
		return tool(
			(input) =>
				this.runTool("file:readFile", input, () => this.readFileOp(input)),
			{
				name: "read_file",
				description:
					"Read a UTF-8 text file. Rejects paths outside the sandbox root " +
					"and files exceeding the size limit. " +
					"Path is relative to the sandbox root — e.g. 'notes.txt', 'data/config.json'. " +
					"Cannot use '..' or absolute paths.",
				schema: readFileSchema,
			},
		);
	}

	writeFileTool(): StructuredTool {
		return tool(
			(input) =>
				this.runTool("file:writeFile", input, () => this.writeFileOp(input)),
			{
				name: "write_file",
				description:
					"Write UTF-8 text to a file (creates parent dirs). Rejects paths " +
					"outside the sandbox root and writes exceeding the size limit. " +
					"Path is relative to the sandbox root — e.g. 'notes.txt', 'subdir/new.txt'. " +
					"Cannot use '..' or absolute paths.",
				schema: writeFileSchema,
			},
		);
	}

	listDirectoryTool(): StructuredTool {
		return tool(
			(input) =>
				this.runTool("file:listDirectory", input, () =>
					this.listDirectoryOp(input),
				),
			{
				name: "list_directory",
				description:
					"List entries in a directory relative to the sandbox root. " +
					"Returns JSON array of {name, isFile, isDirectory, size}. " +
					"Path is relative to the sandbox root — e.g. '.', 'data', 'src'. " +
					"Omit path to list the sandbox root itself.",
				schema: listDirectorySchema,
			},
		);
	}

	deleteFileTool(): StructuredTool {
		return tool(
			(input) =>
				this.runTool("file:deleteFile", input, () => this.deleteFileOp(input)),
			{
				name: "delete_file",
				description:
					"Delete a file. Rejects paths outside the sandbox root. " +
					"ONLY available when readOnly=false. " +
					"Path is relative to the sandbox root — e.g. 'notes.txt', 'tmp/old.txt'. " +
					"Cannot use '..' or absolute paths.",
				schema: deleteFileSchema,
			},
		);
	}

	/**
	 * The full tool set for this instance, honouring readOnly. When readOnly
	 * is true, writeFile and deleteFile are not constructed at all.
	 */
	createTools(): StructuredTool[] {
		if (this.readOnly) {
			return [this.readFileTool(), this.listDirectoryTool()];
		}
		return [
			this.readFileTool(),
			this.writeFileTool(),
			this.listDirectoryTool(),
			this.deleteFileTool(),
		];
	}
}

/**
 * Build the sandboxed file tools for a given config. Validates rootDir at
 * construction (fail loud on misconfiguration).
 */
export function createFileTools(config: FileToolsConfig): StructuredTool[] {
	return new FileTools(config).createTools();
}
