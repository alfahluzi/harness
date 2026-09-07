export type LayerSource = "local" | "global";

export interface AgentTools {
	allow: string[];
	deny: string[];
}

export interface AgentSummary {
	name: string;
	source: LayerSource;
	description: string | null;
	role: string | null;
	temperature: number | null;
	called: string | null;
	tools: AgentTools | null;
}

export interface AgentsListResponse {
	workspaceId: string;
	globalConfigDir: string | null;
	agents: AgentSummary[];
}

export interface AgentDetail {
	name: string;
	source: LayerSource;
	resolvedDir: string;
	description: string | null;
	role: string | null;
	temperature: number | null;
	called: string | null;
	tools: AgentTools | null;
	prompt: string;
}

export interface SkillScript {
	name: string;
	path: string;
}

export interface SkillSummary {
	name: string;
	source: LayerSource;
	description: string | null;
	scriptCount: number;
}

export interface SkillsListResponse {
	workspaceId: string;
	globalConfigDir: string | null;
	skills: SkillSummary[];
}

export interface SkillDetail {
	name: string;
	source: LayerSource;
	resolvedDir: string;
	description: string | null;
	scripts: SkillScript[];
}

export type McpTransport = "stdio" | "sse" | "http";
export type McpStatus = "active" | "deprecated" | "deleted";

export interface EnvironmentVariableInfo {
	name: string;
	description: string | null;
	required: boolean;
	secret: boolean;
}

export interface PublicMcpPackageSummary {
	registryType: string;
	identifier: string;
	version: string;
	transport: McpTransport | null;
	runtimeHint: string | null;
}

export interface PublicMcpPackage extends PublicMcpPackageSummary {
	runtimeArguments: string[];
	environmentVariables: EnvironmentVariableInfo[];
}

export interface PublicMcpRemote {
	type: McpTransport;
	url: string;
	headers: Array<{ name: string; isSecret: boolean }>;
}

export interface PublicMcpSummary {
	name: string;
	description: string | null;
	title: string | null;
	version: string;
	status: McpStatus | null;
	repositoryUrl: string | null;
	packages: PublicMcpPackageSummary[];
}

export interface PublicMcpDetail {
	name: string;
	description: string | null;
	title: string | null;
	version: string;
	status: McpStatus | null;
	repositoryUrl: string | null;
	packages: PublicMcpPackage[];
	remotes: PublicMcpRemote[];
}

export interface McpSearchResponse {
	query: string;
	count: number;
	nextCursor: string | null;
	servers: PublicMcpSummary[];
}

export interface InstalledMcpSummary {
	name: string;
	source: LayerSource;
	title: string | null;
	description: string | null;
	version: string;
	registryType: string | null;
	identifier: string | null;
	transport: McpTransport | null;
	requiredEnvCount: number;
	secretEnvCount: number;
	installedAt: string;
}

export interface InstalledMcpListResponse {
	workspaceId: string;
	globalConfigDir: string | null;
	mcps: InstalledMcpSummary[];
}

export interface InstallConf {
	name: string;
	version: string;
	source: "official-registry";
	installedAt: string;
	title: string | null;
	description: string | null;
	repositoryUrl: string | null;
	status: McpStatus | null;
	packages: PublicMcpPackage[];
	remotes?: PublicMcpRemote[];
}

export interface InstalledMcpDetailResponse {
	name: string;
	source: LayerSource;
	resolvedDir: string;
	conf: InstallConf;
}

export type McpInstallTarget = "local" | "global";

export interface McpInstallResponse {
	name: string;
	installedAt: string;
	version: string;
	target: McpInstallTarget;
}

export interface McpUninstallResponse {
	name: string;
	uninstalled: boolean;
}

export interface DiscoveredWorkspace {
	path: string;
	id: string | null;
}

export interface WorkspacesDiscoverResponse {
	root: string;
	workspaces: DiscoveredWorkspace[];
}