import {
	RegistryListResponse,
	type PublicMcpDetail,
	type PublicMcpSummary,
} from "./schema";

export const DEFAULT_REGISTRY_BASE = "https://registry.modelcontextprotocol.io";
export const DEFAULT_REGISTRY_PATH = "/v0.1";

export class RegistryError extends Error {
	readonly status: number;
	override readonly cause?: unknown;
	constructor(message: string, status: number, cause?: unknown) {
		super(message);
		this.name = "RegistryError";
		this.status = status;
		this.cause = cause;
	}
}

export class RegistryNotFoundError extends RegistryError {
	constructor(name: string) {
		super(`MCP not found in registry: ${name}`, 404);
		this.name = "RegistryNotFoundError";
	}
}

interface FetchOpts {
	signal?: AbortSignal;
}

/**
 * Thin HTTP client for the official MCP Registry.
 *
 * No auth: the official registry is read-public; only publishing requires
 * namespace auth (DNS/GitHub/etc), which is out of scope for install/uninstall.
 */
export class RegistryClient {
	private base: string;
	private path: string;

	constructor(opts: { base?: string; path?: string } = {}) {
		this.base = (opts.base ?? DEFAULT_REGISTRY_BASE).replace(/\/$/, "");
		this.path = (opts.path ?? DEFAULT_REGISTRY_PATH).replace(/\/$/, "");
	}

	private url(path: string, params?: Record<string, string | undefined>): string {
		const u = new URL(`${this.path}${path}`, this.base);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined && v !== "") u.searchParams.set(k, v);
			}
		}
		return u.toString();
	}

	private async fetchJson<T>(
		path: string,
		params: Record<string, string | undefined> | undefined,
		opts: FetchOpts,
	): Promise<T> {
		let res: Response;
		try {
			res = await fetch(this.url(path, params), { signal: opts.signal });
		} catch (e) {
			throw new RegistryError(`Registry request failed: ${(e as Error).message}`, 0, e);
		}
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new RegistryError(
				`Registry ${res.status}: ${body.slice(0, 200) || res.statusText}`,
				res.status,
			);
		}
		try {
			return (await res.json()) as T;
		} catch (e) {
			throw new RegistryError(
				`Registry returned invalid JSON: ${(e as Error).message}`,
				res.status,
				e,
			);
		}
	}

	async search(
		query: string,
		opts: { cursor?: string; signal?: AbortSignal } = {},
	): Promise<{ servers: PublicMcpSummary[]; nextCursor: string | null }> {
		const raw = await this.fetchJson<unknown>(
			"/servers",
			{ search: query, version: "latest", cursor: opts.cursor },
			{ signal: opts.signal },
		);
		const parsed = RegistryListResponse.parse(raw);
		return {
			servers: parsed.servers.map(toSummary),
			nextCursor: parsed.metadata?.nextCursor ?? null,
		};
	}

	async getLatest(
		name: string,
		opts: { version?: string; signal?: AbortSignal } = {},
	): Promise<PublicMcpDetail> {
		const version = opts.version ?? "latest";
		const encoded = encodeURIComponent(name);
		let raw: unknown;
		try {
			raw = await this.fetchJson<unknown>(
				`/servers/${encoded}/versions/${encodeURIComponent(version)}`,
				undefined,
				{ signal: opts.signal },
			);
		} catch (e) {
			if (e instanceof RegistryError && e.status === 404) {
				throw new RegistryNotFoundError(name);
			}
			throw e;
		}
		const obj = raw as { server?: unknown } & Record<string, unknown>;
		const server = (obj.server ?? obj) as Record<string, unknown>;
		return toDetail(name, server);
	}
}

// ---------------------------------------------------------------------------
// Normalization helpers — convert raw registry JSON into the public shape
// ---------------------------------------------------------------------------

function asArray<T>(v: unknown): T[] {
	return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
	return typeof v === "number" ? v : null;
}

function asBool(v: unknown): boolean | null {
	return typeof v === "boolean" ? v : null;
}

function metaStatus(meta: unknown): "active" | "deprecated" | "deleted" | null {
	const obj = (meta as Record<string, unknown> | undefined)?.[
		"io.modelcontextprotocol.registry/official"
	] as Record<string, unknown> | undefined;
	const status = obj?.status;
	if (status === "active" || status === "deprecated" || status === "deleted") return status;
	return null;
}

function toTransport(v: unknown): "stdio" | "sse" | "http" | null {
	const obj = v as { type?: unknown } | null | undefined;
	const t = obj?.type;
	if (t === "stdio" || t === "sse" || t === "http") return t;
	return null;
}

function summarizePackage(p: Record<string, unknown>): PublicMcpSummary["packages"][number] {
	return {
		registryType: String(p.registryType ?? "unknown"),
		identifier: String(p.identifier ?? ""),
		version: String(p.version ?? ""),
		transport: toTransport(p.transport),
		runtimeHint: asString(p.runtimeHint),
	};
}

export function toSummary(entry: {
	server: Record<string, unknown>;
	_meta?: Record<string, unknown>;
}): PublicMcpSummary {
	const s = entry.server;
	const repo = s.repository as Record<string, unknown> | undefined;
	return {
		name: String(s.name),
		description: asString(s.description),
		title: asString(s.title),
		version: String(s.version ?? ""),
		status: metaStatus(entry._meta),
		repositoryUrl: asString(repo?.url),
		packages: asArray<Record<string, unknown>>(s.packages).map(summarizePackage),
	};
}

function envVarsFromPackage(p: Record<string, unknown>): PublicMcpDetail["packages"][number]["environmentVariables"] {
	return asArray<Record<string, unknown>>(p.environmentVariables).map((e) => ({
		name: String(e.name ?? ""),
		description: asString(e.description),
		required: e.isRequired === true,
		secret: e.isSecret === true,
	}));
}

function argsToStrings(arr: unknown): string[] {
	return asArray<Record<string, unknown>>(arr)
		.map((a) => {
			const v = a.value;
			const n = a.name;
			if (typeof v === "string") return v;
			if (typeof v === "number" || typeof v === "boolean") return String(v);
			if (typeof n === "string") return n;
			return null;
		})
		.filter((x): x is string => x !== null);
}

function detailPackage(
	p: Record<string, unknown>,
): PublicMcpDetail["packages"][number] {
	return {
		registryType: String(p.registryType ?? "unknown"),
		identifier: String(p.identifier ?? ""),
		version: String(p.version ?? ""),
		transport: toTransport(p.transport),
		runtimeHint: asString(p.runtimeHint),
		runtimeArguments: argsToStrings(p.runtimeArguments),
		environmentVariables: envVarsFromPackage(p),
	};
}

function detailRemote(r: Record<string, unknown>): PublicMcpDetail["remotes"][number] {
	return {
		type: r.type === "http" ? "http" : "sse",
		url: String(r.url ?? ""),
		headers: asArray<Record<string, unknown>>(r.headers).map((h) => ({
			name: String(h.name ?? ""),
			isSecret: h.isSecret === true,
		})),
	};
}

export function toDetail(name: string, server: Record<string, unknown>): PublicMcpDetail {
	const repo = server.repository as Record<string, unknown> | undefined;
	return {
		name: String(server.name ?? name),
		description: asString(server.description),
		title: asString(server.title),
		version: String(server.version ?? ""),
		status: metaStatus(server._meta),
		repositoryUrl: asString(repo?.url),
		packages: asArray<Record<string, unknown>>(server.packages).map(detailPackage),
		remotes: asArray<Record<string, unknown>>(server.remotes).map(detailRemote),
	};
}

// re-export for tests / advanced callers
export const __test = { asString, asBool, asNumber, asArray, toTransport, metaStatus };