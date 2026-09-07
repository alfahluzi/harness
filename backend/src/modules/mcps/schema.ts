// Side-effect import: `@hono/zod-openapi` registers the `.openapi()` extension
// on the zod prototype. Importing for side effects ensures the extension is
// available whenever this module is loaded (including in tests that import
// this file directly without going through a `route.ts`).
import "@hono/zod-openapi";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared / path / param schemas (mirror skills/agents conventions)
// ---------------------------------------------------------------------------

export const ConfigDirQuery = z.object({
	configDir: z.string().min(1),
});

export const McpNameParam = z.object({
	name: z.string().min(1),
});

export const SearchQuery = z.object({
	q: z.string().min(1),
	cursor: z.string().optional(),
});

export const InstallBody = z.object({
	name: z.string().min(1),
	version: z.string().min(1).optional(),
	target: z.enum(["local", "global"]).optional(),
});

// ---------------------------------------------------------------------------
// Public registry response shape
// ---------------------------------------------------------------------------

const PackageTransport = z
	.object({
		type: z.enum(["stdio", "sse", "http"]),
	})
	.passthrough();

const PackageRuntimeArgument = z
	.object({
		type: z.enum(["positional", "named"]),
		name: z.string().optional(),
		value: z.string().optional(),
		description: z.string().optional(),
	})
	.passthrough();

const EnvironmentVariable = z
	.object({
		name: z.string(),
		description: z.string().optional(),
		isRequired: z.boolean().optional(),
		isSecret: z.boolean().optional(),
		default: z.string().optional(),
		format: z.string().optional(),
	})
	.passthrough();

const RegistryPackage = z
	.object({
		registryType: z.enum(["npm", "pypi", "oci", "nuget", "mcpb"]),
		registryBaseUrl: z.string().optional(),
		identifier: z.string(),
		version: z.string(),
		runtimeHint: z.string().optional(),
		transport: PackageTransport.optional(),
		runtimeArguments: z.array(PackageRuntimeArgument).optional(),
		packageArguments: z.array(PackageRuntimeArgument).optional(),
		environmentVariables: z.array(EnvironmentVariable).optional(),
		fileSha256: z.string().optional(),
	})
	.passthrough();

const RegistryRemote = z
	.object({
		type: z.enum(["sse", "http"]),
		url: z.string(),
		headers: z
			.array(
				z
					.object({
						name: z.string(),
						value: z.string().optional(),
						isSecret: z.boolean().optional(),
						description: z.string().optional(),
					})
					.passthrough(),
			)
			.optional(),
	})
	.passthrough();

const RegistryRepository = z
	.object({
		url: z.string().optional(),
		source: z.string().optional(),
		subfolder: z.string().optional(),
	})
	.passthrough();

const RegistryServer = z
	.object({
		name: z.string(),
		description: z.string().optional(),
		title: z.string().optional(),
		version: z.string(),
		repository: RegistryRepository.optional(),
		packages: z.array(RegistryPackage).optional(),
		remotes: z.array(RegistryRemote).optional(),
	})
	.passthrough();

const RegistryMeta = z
	.object({
		"io.modelcontextprotocol.registry/official": z
			.object({
				status: z.enum(["active", "deprecated", "deleted"]).optional(),
				isLatest: z.boolean().optional(),
				publishedAt: z.string().optional(),
				updatedAt: z.string().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

export const RegistryListResponse = z
	.object({
		servers: z.array(z.object({ server: RegistryServer, _meta: RegistryMeta.optional() })),
		metadata: z
			.object({
				nextCursor: z.string().optional(),
				count: z.number().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

// ---------------------------------------------------------------------------
// Public surface (normalized output)
// ---------------------------------------------------------------------------

const PackageSummary = z.object({
	registryType: z.string(),
	identifier: z.string(),
	version: z.string(),
	transport: z.enum(["stdio", "sse", "http"]).nullable(),
	runtimeHint: z.string().nullable(),
});
export type PackageSummary = z.infer<typeof PackageSummary>;

export const PublicMcpSummary = z
	.object({
		name: z.string(),
		description: z.string().nullable(),
		title: z.string().nullable(),
		version: z.string(),
		status: z.enum(["active", "deprecated", "deleted"]).nullable(),
		repositoryUrl: z.string().nullable(),
		packages: z.array(PackageSummary),
	})
	.openapi("PublicMcpSummary");
export type PublicMcpSummary = z.infer<typeof PublicMcpSummary>;

export const EnvironmentVariableInfo = z.object({
	name: z.string(),
	description: z.string().nullable(),
	required: z.boolean(),
	secret: z.boolean(),
});
export type EnvironmentVariableInfo = z.infer<typeof EnvironmentVariableInfo>;

export const PublicMcpDetail = z
	.object({
		name: z.string(),
		description: z.string().nullable(),
		title: z.string().nullable(),
		version: z.string(),
		status: z.enum(["active", "deprecated", "deleted"]).nullable(),
		repositoryUrl: z.string().nullable(),
		packages: z.array(
			z
				.object({
					registryType: z.string(),
					identifier: z.string(),
					version: z.string(),
					transport: z.enum(["stdio", "sse", "http"]).nullable(),
					runtimeHint: z.string().nullable(),
					runtimeArguments: z.array(z.string()),
					environmentVariables: z.array(EnvironmentVariableInfo),
				})
				.passthrough(),
		),
		remotes: z.array(
			z
				.object({
					type: z.enum(["sse", "http"]),
					url: z.string(),
					headers: z.array(
						z.object({
							name: z.string(),
							isSecret: z.boolean(),
						}),
					),
				})
				.passthrough(),
		),
	})
	.openapi("PublicMcpDetail");
export type PublicMcpDetail = z.infer<typeof PublicMcpDetail>;

export const SearchResponse = z
	.object({
		query: z.string(),
		count: z.number(),
		nextCursor: z.string().nullable(),
		servers: z.array(PublicMcpSummary),
	})
	.openapi("McpSearchResponse");
export type SearchResponse = z.infer<typeof SearchResponse>;

// ---------------------------------------------------------------------------
// Installed MCP (filesystem conf.json shape)
// ---------------------------------------------------------------------------

const InstalledPackage = z
	.object({
		registryType: z.string(),
		identifier: z.string(),
		version: z.string(),
		transport: z.enum(["stdio", "sse", "http"]).nullable(),
		runtimeHint: z.string().nullable(),
		runtimeArguments: z.array(z.string()),
		environmentVariables: z.array(EnvironmentVariableInfo),
	})
	.passthrough();
export type InstalledPackage = z.infer<typeof InstalledPackage>;

export const InstallConf = z
	.object({
		name: z.string(),
		version: z.string(),
		source: z.literal("official-registry"),
		installedAt: z.string(),
		title: z.string().nullable(),
		description: z.string().nullable(),
		repositoryUrl: z.string().nullable(),
		status: z.enum(["active", "deprecated", "deleted"]).nullable(),
		packages: z.array(InstalledPackage),
		remotes: z
			.array(
				z
					.object({
						type: z.enum(["sse", "http"]),
						url: z.string(),
						headers: z.array(
							z.object({
								name: z.string(),
								isSecret: z.boolean(),
							}),
						),
					})
					.passthrough(),
			)
			.optional(),
	})
	.passthrough();
export type InstallConf = z.infer<typeof InstallConf>;

export const InstalledMcpSummary = z
	.object({
		name: z.string(),
		source: z.enum(["local", "global"]),
		title: z.string().nullable(),
		description: z.string().nullable(),
		version: z.string(),
		registryType: z.string().nullable(),
		identifier: z.string().nullable(),
		transport: z.enum(["stdio", "sse", "http"]).nullable(),
		requiredEnvCount: z.number(),
		secretEnvCount: z.number(),
		installedAt: z.string(),
	})
	.openapi("InstalledMcpSummary");
export type InstalledMcpSummary = z.infer<typeof InstalledMcpSummary>;

export const InstalledListResponse = z
	.object({
		workspaceId: z.string(),
		globalConfigDir: z.string().nullable(),
		mcps: z.array(InstalledMcpSummary),
	})
	.openapi("InstalledMcpListResponse");
export type InstalledListResponse = z.infer<typeof InstalledListResponse>;

export const InstalledDetailResponse = z
	.object({
		name: z.string(),
		source: z.enum(["local", "global"]),
		resolvedDir: z.string(),
		conf: InstallConf,
	})
	.openapi("InstalledMcpDetailResponse");
export type InstalledDetailResponse = z.infer<typeof InstalledDetailResponse>;

export const InstallResponse = z
	.object({
		name: z.string(),
		installedAt: z.string(),
		version: z.string(),
		target: z.enum(["local", "global"]),
	})
	.openapi("McpInstallResponse");
export type InstallResponse = z.infer<typeof InstallResponse>;

export const UninstallResponse = z
	.object({
		name: z.string(),
		uninstalled: z.boolean(),
	})
	.openapi("McpUninstallResponse");
export type UninstallResponse = z.infer<typeof UninstallResponse>;

export const ErrorResponse = z.object({ error: z.string() }).openapi("Error");
export type ErrorResponse = z.infer<typeof ErrorResponse>;