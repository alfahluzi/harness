import type {
	AgentDetail,
	AgentsListResponse,
	InstalledMcpDetailResponse,
	InstalledMcpListResponse,
	McpInstallResponse,
	McpSearchResponse,
	McpUninstallResponse,
	PublicMcpDetail,
	ProviderConnectInput,
	ProviderDetail,
	ProviderDisconnectResponse,
	ProviderModelsResponse,
	ProvidersListResponse,
	ProviderTestInput,
	ProviderTestResult,
	ProviderUpdateInput,
	SessionsListResponse,
	SkillDetail,
	SkillsListResponse,
	WorkspacesDiscoverResponse,
} from "../types/puna";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function buildUrl(path: string, params?: Record<string, string | undefined>): string {
	const url = new URL(BASE_URL + path);
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== "") url.searchParams.set(k, v);
		}
	}
	return url.toString();
}

async function parseBody(res: Response): Promise<unknown> {
	const text = await res.text();
	if (!res.ok) throw new ApiError(res.status, text || res.statusText);
	return text ? JSON.parse(text) : undefined;
}

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
	const res = await fetch(buildUrl(path, params));
	return (await parseBody(res)) as T;
}

async function post<T, B = unknown>(
	path: string,
	body: B,
	params?: Record<string, string | undefined>,
): Promise<T> {
	const res = await fetch(buildUrl(path, params), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return (await parseBody(res)) as T;
}

async function put<T, B = unknown>(
	path: string,
	body: B,
	params?: Record<string, string | undefined>,
): Promise<T> {
	const res = await fetch(buildUrl(path, params), {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return (await parseBody(res)) as T;
}

async function del<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
	const res = await fetch(buildUrl(path, params), { method: "DELETE" });
	return (await parseBody(res)) as T;
}

export const api = {
	agents: {
		list: (configDir: string) => get<AgentsListResponse>("/api/agents", { configDir }),
		get: (configDir: string, name: string) =>
			get<AgentDetail>(`/api/agents/${encodeURIComponent(name)}`, { configDir }),
	},
	skills: {
		list: (configDir: string) => get<SkillsListResponse>("/api/skills", { configDir }),
		get: (configDir: string, name: string) =>
			get<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`, { configDir }),
	},
	mcps: {
		search: (q: string, cursor?: string) =>
			get<McpSearchResponse>("/api/mcps/search", { q, cursor }),
		registryDetail: (name: string, version?: string) =>
			get<PublicMcpDetail>(`/api/mcps/registry/${encodeURIComponent(name)}`, { version }),
		listInstalled: (configDir: string) =>
			get<InstalledMcpListResponse>("/api/mcps/installed", { configDir }),
		getInstalled: (configDir: string, name: string) =>
			get<InstalledMcpDetailResponse>(
				`/api/mcps/installed/${encodeURIComponent(name)}`,
				{ configDir },
			),
		install: (
			configDir: string,
			body: { name: string; version?: string; target?: "local" | "global" },
		) =>
			post<McpInstallResponse, { name: string; version?: string; target?: "local" | "global" }>(
				"/api/mcps/install",
				body,
				{ configDir },
			),
		uninstall: (configDir: string, name: string) =>
			del<McpUninstallResponse>(
				`/api/mcps/installed/${encodeURIComponent(name)}`,
				{ configDir },
			),
	},
	providers: {
		list: (configDir: string) =>
			get<ProvidersListResponse>("/api/providers", { configDir }),
		get: (configDir: string, id: string) =>
			get<ProviderDetail>(`/api/providers/${encodeURIComponent(id)}`, { configDir }),
		models: (configDir: string, id: string) =>
			get<ProviderModelsResponse>(
				`/api/providers/${encodeURIComponent(id)}/models`,
				{ configDir },
			),
		test: (configDir: string, body: ProviderTestInput) =>
			post<ProviderTestResult, ProviderTestInput>("/api/providers/test", body, {
				configDir,
			}),
		connect: (configDir: string, body: ProviderConnectInput) =>
			post<ProviderDetail, ProviderConnectInput>("/api/providers/connect", body, {
				configDir,
			}),
		update: (configDir: string, id: string, body: ProviderUpdateInput) =>
			put<ProviderDetail, ProviderUpdateInput>(
				`/api/providers/${encodeURIComponent(id)}`,
				body,
				{ configDir },
			),
		disconnect: (configDir: string, id: string) =>
			del<ProviderDisconnectResponse>(
				`/api/providers/${encodeURIComponent(id)}`,
				{ configDir },
			),
	},
	workspaces: {
		discover: (root?: string) =>
			get<WorkspacesDiscoverResponse>("/api/workspaces/discover", { root }),
	},
	sessions: {
		list: (workspaceId: string) =>
			get<SessionsListResponse>("/api/sessions", { workspaceId }),
	},
};

export { ApiError };