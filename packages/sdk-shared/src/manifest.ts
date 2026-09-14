/**
 * Plugin manifest schema — single source of truth for `plugin.json` parsing.
 *
 * Consumed by the backend plugin module (validation, `/api/plugins` routes)
 * and by the frontend registry (typed summaries). See strategy §4 and §12 Q2.
 *
 * Strict by construction: unknown fields are rejected with a ZodError that
 * names the offending key (`Unrecognized key: "<name>"`).
 */
import { z } from "zod";
import { PluginSource } from "./source";

/** Semver 2.0.0 — official regex from semver.org. */
export const SEMVER_RE =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
const DOTDOT_SEGMENT_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

/**
 * Cross-platform absolute-path check (browser-safe: no `node:path` import).
 * Covers POSIX `/`, Windows drive `C:`, and leading-backslash `\`/UNC forms.
 */
function isAbsolutePath(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("\\") ||
		WINDOWS_DRIVE_RE.test(value)
	);
}

/**
 * Relative path guard for every `entry` field.
 * Rejects: absolute paths, `..` segments, and NUL bytes.
 */
export const safeRelativePath = z
	.string()
	.min(1, "path must not be empty")
	.refine((value) => !value.includes("\0"), "path must not contain a NUL byte")
	.refine(
		(value) => !isAbsolutePath(value),
		"path must be relative (no leading '/', '\\', or drive letter)",
	)
	.refine(
		(value) => !DOTDOT_SEGMENT_RE.test(value),
		"path must not contain '..' segments",
	);

/** Entry point for a capability: relative module path + optional named export. */
export const CapabilityEntry = z.strictObject({
	entry: safeRelativePath,
	export: z.string().min(1).optional(),
});
export type CapabilityEntry = z.infer<typeof CapabilityEntry>;

/** LangGraph contribution: `namespace` disambiguates across plugins. */
export const PluginGraph = z.strictObject({
	id: z
		.string()
		.regex(/^[a-z][a-z0-9-]*$/, "graph id must be kebab-case"),
	entry: safeRelativePath,
	export: z.string().min(1).default("graph"),
	alias: z.string().min(1).optional(),
	namespace: z.string().min(1).optional(),
});
export type PluginGraph = z.infer<typeof PluginGraph>;

export const PluginCapabilities = z.strictObject({
	leftBar: CapabilityEntry.optional(),
	footerBar: CapabilityEntry.optional(),
	chatRenderers: CapabilityEntry.optional(),
	toolUi: CapabilityEntry.optional(),
	backendHooks: CapabilityEntry.optional(),
	tools: CapabilityEntry.extend({
		export: z.literal("default.tools").optional(),
	}).optional(),
	graphs: z.array(PluginGraph).optional(),
});
export type PluginCapabilities = z.infer<typeof PluginCapabilities>;

/** `shell` uses the structured form (`command` + optional `args`) only. */
export const PluginShellPermission = z.strictObject({
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
});
export type PluginShellPermission = z.infer<typeof PluginShellPermission>;

export const PluginPermissions = z.strictObject({
	fs: z
		.strictObject({
			read: z.array(safeRelativePath).optional(),
			write: z.array(safeRelativePath).optional(),
		})
		.optional(),
	net: z
		.strictObject({
			hosts: z.array(z.string().min(1)).optional(),
		})
		.optional(),
	shell: z.array(PluginShellPermission).optional(),
});
export type PluginPermissions = z.infer<typeof PluginPermissions>;

/**
 * `@hono/zod-openapi` injects `.openapi(name)` onto the zod prototype when
 * imported. sdk-shared deliberately does not depend on that package, so guard
 * the call: when the patch is active (backend process) the schema is registered
 * as a named component; otherwise parsing still works.
 */
function registerOpenApi<T extends z.ZodType>(schema: T, name: string): T {
	const candidate = schema as T & { openapi?: (refId: string) => T };
	return typeof candidate.openapi === "function"
		? candidate.openapi(name)
		: schema;
}

export const PluginManifest = registerOpenApi(
	z.strictObject({
		/** JSON Schema pointer, e.g. `https://puna.dev/schemas/plugin.v1.json`. */
		$schema: z.string().min(1).optional(),
		id: z.string().min(1, "id must not be empty"),
		name: z.string().min(1, "name must not be empty"),
		version: z
			.string()
			.regex(SEMVER_RE, "version must be a valid semver string"),
		description: z.string(),
		author: z.string().optional(),
		license: z.string().optional(),
		engines: z.strictObject({
			puna: z.string().min(1, "engines.puna must not be empty"),
		}),
		capabilities: PluginCapabilities.optional(),
		permissions: PluginPermissions.optional(),
	}),
	"PluginManifest",
);
export type PluginManifest = z.infer<typeof PluginManifest>;

/** Derived client-side from which capabilities are present. */
export const PluginKind = z.enum(["ui", "agent-hook", "graph", "mixed"]);
export type PluginKind = z.infer<typeof PluginKind>;

/** Lighter shape for `/api/plugins` list endpoints. */
export const PluginSummary = registerOpenApi(
	z.strictObject({
		id: z.string().min(1),
		name: z.string().min(1),
		version: z.string().regex(SEMVER_RE, "version must be a valid semver"),
		description: z.string().optional(),
		source: PluginSource,
		resolvedDir: z.string().min(1),
		kind: PluginKind,
	}),
	"PluginSummary",
);
export type PluginSummary = z.infer<typeof PluginSummary>;
