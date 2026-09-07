import { config } from "../../global/config";
import { loadWorkspaceContext, InvalidWorkspaceError } from "../../global/workspace-context";
import {
	ProviderRepository,
	type ProviderRecord,
	type ProviderSourceRecord,
} from "./provider-repository";
import { ProviderModelRepository } from "./repository";
import {
	GLOBAL_WORKSPACE_ID,
} from "../../models/providers";
import {
	ProviderKind,
	type ProviderConnectInput,
	type ProviderDetail,
	type ProviderModelsResponse,
	type ProviderSummary,
	type ProviderTestInput,
	type ProviderTestResult,
	type ProviderUpdateInput,
} from "./schema";

const CONNECT_TIMEOUT_MS = 10_000;

export class ProviderNotFoundError extends Error {
	constructor(id: string) {
		super(`Provider not connected: ${id}`);
		this.name = "ProviderNotFoundError";
	}
}

export class ProviderAlreadyConnectedError extends Error {
	constructor(type: string) {
		super(`Provider already connected: ${type}`);
		this.name = "ProviderAlreadyConnectedError";
	}
}

export class ProviderConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderConfigError";
	}
}

interface ProviderCatalogEntry {
	label: string;
	baseUrl: string;
	defaultModel: string;
}

const CATALOG: Record<ProviderKind, ProviderCatalogEntry> = {
	openai: {
		label: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		defaultModel: "gpt-4o",
	},
	anthropic: {
		label: "Anthropic",
		baseUrl: "https://api.anthropic.com",
		defaultModel: "claude-sonnet-4-20250514",
	},
	google: {
		label: "Google",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		defaultModel: "gemini-2.5-flash",
	},
	openrouter: {
		label: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		defaultModel: "openai/gpt-4o",
	},
	custom: {
		label: "Custom",
		baseUrl: "",
		defaultModel: "custom",
	},
};

interface TestRequest {
	url: string;
	headers: Record<string, string>;
	body: unknown;
}

function buildTestRequest(
	kind: ProviderKind,
	record: ProviderRecord,
): TestRequest {
	const base = record.baseUrl.replace(/\/+$/, "");
	switch (kind) {
		case "openai":
		case "openrouter":
		case "custom":
			return {
				url: `${base}/chat/completions`,
				headers: {
					authorization: `Bearer ${record.apiKey}`,
					"content-type": "application/json",
				},
				body: {
					model: record.defaultModel,
					messages: [{ role: "user", content: "ping" }],
					max_tokens: 1,
				},
			};
		case "anthropic": {
			const apiRoot = base.endsWith("/v1") ? base : `${base}/v1`;
			return {
				url: `${apiRoot}/messages`,
				headers: {
					"x-api-key": record.apiKey,
					"anthropic-version": "2023-06-01",
					"content-type": "application/json",
				},
				body: {
					model: record.defaultModel,
					max_tokens: 1,
					messages: [{ role: "user", content: "ping" }],
				},
			};
		}
		case "google":
			return {
				url: `${base}/models/${encodeURIComponent(record.defaultModel)}:generateContent`,
				headers: {
					"x-goog-api-key": record.apiKey,
					"content-type": "application/json",
				},
				body: { contents: [{ parts: [{ text: "ping" }] }] },
			};
	}
}

function buildModelsRequest(
	kind: ProviderKind,
	record: ProviderRecord,
): { url: string; headers: Record<string, string> } {
	const base = record.baseUrl.replace(/\/+$/, "");
	switch (kind) {
		case "openai":
		case "openrouter":
		case "custom":
			return {
				url: `${base}/models`,
				headers: { authorization: `Bearer ${record.apiKey}` },
			};
		case "anthropic": {
			const apiRoot = base.endsWith("/v1") ? base : `${base}/v1`;
			return {
				url: `${apiRoot}/models`,
				headers: { "x-api-key": record.apiKey, "anthropic-version": "2023-06-01" },
			};
		}
		case "google":
			return { url: `${base}/models`, headers: { "x-goog-api-key": record.apiKey } };
	}
}

function parseModels(
	kind: ProviderKind,
	payload: unknown,
): Array<{ modelId: string; name: string | null }> {
	const obj = payload as {
		data?: Array<{ id?: unknown; display_name?: unknown; displayName?: unknown }>;
		models?: Array<{ name?: unknown; displayName?: unknown; display_name?: unknown }>;
	};

	let entries: Array<{ id?: string; name?: string | null } | null>;
	if (kind === "google") {
		const list = Array.isArray(obj.models) ? obj.models : [];
		entries = list.map((m) => {
			const raw = typeof m.name === "string" ? m.name : "";
			const id = raw.replace(/^models\//, "");
			const name =
				typeof m.displayName === "string"
					? m.displayName
					: typeof m.display_name === "string"
						? m.display_name
						: null;
			return id ? { id, name } : null;
		});
	} else {
		const list = Array.isArray(obj.data) ? obj.data : [];
		entries = list.map((m) => {
			const id = typeof m.id === "string" ? m.id : "";
			const name =
				typeof m.display_name === "string"
					? m.display_name
					: typeof m.displayName === "string"
						? m.displayName
						: null;
			return id ? { id, name } : null;
		});
	}

	const byId = new Map<string, { modelId: string; name: string | null }>();
	for (const e of entries) {
		if (e?.id) byId.set(e.id, { modelId: e.id, name: e.name ?? null });
	}
	return [...byId.values()].sort((a, b) => a.modelId.localeCompare(b.modelId));
}

function maskKey(key: string): string {
	if (key.length <= 8) return `…${key.slice(-4)}`;
	return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Service for managing connected LLM providers.
 *
 * Provider configuration lives in the `providers` DB table (one row per
 * `(id, workspace_id)`); `'__global__'` is the workspace sentinel for rows
 * connected with `target: "global"` that are visible to every workspace.
 *
 * Synced models from each provider's `/models` endpoint live in
 * `provider_models` with a composite FK back to `providers(id, workspace_id)`
 * (cascade delete), so disconnecting a provider removes its models in one shot.
 *
 * Local-vs-global shadowing is preserved: when listing for workspace X we
 * pull both the workspace's rows and the global sentinel, then dedupe by id
 * with local winning.
 */
export class ProviderService {
	private providerRepo: ProviderRepository;
	private modelRepo: ProviderModelRepository;

	constructor(opts: {
		providerRepo?: ProviderRepository;
		modelRepo?: ProviderModelRepository;
	} = {}) {
		this.providerRepo = opts.providerRepo ?? new ProviderRepository();
		this.modelRepo = opts.modelRepo ?? new ProviderModelRepository();
	}

	// -------------------------------------------------------------------------
	// Read
	// -------------------------------------------------------------------------

	async list(
		configDir: string,
	): Promise<{ workspaceId: string; globalConfigDir: string | null; providers: ProviderSummary[] }> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const visible = this.providerRepo.listForWorkspace(ctx.id);
		const merged = mergeWithLocalWins(visible);
		const providers = await Promise.all(merged.map((r) => toSummary(r)));
		return {
			workspaceId: ctx.id,
			globalConfigDir: ctx.globalConfigDir,
			providers,
		};
	}

	async get(configDir: string, id: string): Promise<ProviderDetail> {
		const rec = await this.resolve(configDir, id);
		return toDetail(toSourceRecord(rec));
	}

	async models(configDir: string, id: string): Promise<ProviderModelsResponse> {
		const rec = await this.resolve(configDir, id);
		const records = this.modelRepo.listByProvider(rec.workspaceId, rec.id);
		return {
			providerId: rec.id,
			models: records.map((r) => ({
				providerId: r.providerId,
				modelId: r.modelId,
				name: r.name,
			})),
		};
	}

	// -------------------------------------------------------------------------
	// Test (no side effects)
	// -------------------------------------------------------------------------

	async testCredentials(
		configDir: string,
		input: ProviderTestInput,
	): Promise<ProviderTestResult> {
		let rec: ProviderRecord;
		if (input.apiKey && input.apiKey.trim().length > 0) {
			if (input.type === "custom" && !input.baseUrl?.trim()) {
				throw new ProviderConfigError("baseUrl is required for custom providers");
			}
			const catalog = CATALOG[input.type];
			// Workspace scope is irrelevant for an ad-hoc test; use a placeholder.
			rec = {
				id: input.type,
				workspaceId: "__test__",
				type: input.type,
				name: catalog.label,
				baseUrl: (input.baseUrl?.trim() || catalog.baseUrl).replace(/\/+$/, ""),
				apiKey: input.apiKey.trim(),
				defaultModel: catalog.defaultModel,
				createdAt: 0,
				updatedAt: 0,
			};
		} else {
			rec = await this.resolve(configDir, input.type);
		}
		return this.runTest(input.type, rec);
	}

	// -------------------------------------------------------------------------
	// Mutate: connect / update / disconnect
	// -------------------------------------------------------------------------

	async connect(configDir: string, input: ProviderConnectInput): Promise<ProviderDetail> {
		const target: "local" | "global" = input.target ?? "local";
		const ctx = await loadWorkspaceContext(configDir, configDir);
		const workspaceId =
			target === "global" ? GLOBAL_WORKSPACE_ID : ctx.id;

		if (this.providerRepo.existsInScope(input.type, ctx.id)) {
			throw new ProviderAlreadyConnectedError(input.type);
		}

		const apiKey = input.apiKey.trim();
		if (!apiKey) throw new ProviderConfigError("apiKey is required");
		if (input.type === "custom" && !input.baseUrl?.trim()) {
			throw new ProviderConfigError("baseUrl is required for custom providers");
		}
		const catalog = CATALOG[input.type];
		const now = Date.now();
		const baseUrl = (input.baseUrl?.trim() || catalog.baseUrl).replace(/\/+$/, "");

		let rec: ProviderRecord = {
			id: input.type,
			workspaceId,
			type: input.type,
			name: input.name?.trim() || catalog.label,
			baseUrl,
			apiKey,
			defaultModel: catalog.defaultModel,
			createdAt: now,
			updatedAt: now,
		};

		this.providerRepo.insert(rec);

		const synced = await this.syncModels(configDir, rec);
		if (synced && synced.length > 0) {
			rec = { ...rec, defaultModel: synced[0]!.modelId, updatedAt: Date.now() };
			this.providerRepo.update(rec);
		}

		return toDetail(toSourceRecord(rec));
	}

	async update(
		configDir: string,
		id: string,
		input: ProviderUpdateInput,
	): Promise<ProviderDetail> {
		const existing = await this.resolve(configDir, id);
		const next: ProviderRecord = {
			...existing,
			name: input.name?.trim() || existing.name,
			baseUrl:
				input.baseUrl !== undefined && input.baseUrl.trim() !== ""
					? input.baseUrl.trim().replace(/\/+$/, "")
					: existing.baseUrl,
			apiKey:
				input.apiKey !== undefined && input.apiKey.trim() !== ""
					? input.apiKey.trim()
					: existing.apiKey,
			updatedAt: Date.now(),
		};
		this.providerRepo.update(next);
		await this.syncModels(configDir, next);
		return toDetail(toSourceRecord(next));
	}

	async disconnect(
		configDir: string,
		id: string,
	): Promise<{ id: string; disconnected: true }> {
		const rec = await this.resolve(configDir, id);
		// Cascade FK clears provider_models in the same transaction.
		this.providerRepo.delete(rec.id, rec.workspaceId);
		return { id: rec.id, disconnected: true };
	}

	// -------------------------------------------------------------------------
	// Model sync (best-effort: provider reachable + non-empty list required)
	// -------------------------------------------------------------------------

	async syncModels(
		configDir: string,
		rec: ProviderRecord,
	): Promise<Array<{ modelId: string; name: string | null }> | null> {
		const { url, headers } = buildModelsRequest(rec.type as ProviderKind, rec);
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
		try {
			const res = await fetch(url, { headers, signal: ctrl.signal });
			if (!res.ok) return null;
			const payload = (await res.json()) as unknown;
			const models = parseModels(rec.type as ProviderKind, payload);
			if (models.length === 0) return null;
			this.modelRepo.replaceAll(rec.workspaceId, rec.id, models, Date.now());
			return models;
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}

	// -------------------------------------------------------------------------
	// Internal helpers
	// -------------------------------------------------------------------------

	private async runTest(
		id: string,
		rec: ProviderRecord,
	): Promise<ProviderTestResult> {
		if (rec.type === "custom") {
			const { url, headers } = buildModelsRequest(rec.type as ProviderKind, rec);
			const started = Date.now();
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
			try {
				const res = await fetch(url, { headers, signal: ctrl.signal });
				const latencyMs = Date.now() - started;
				if (res.ok) return { id, ok: true, latencyMs, error: null };
				const text = await res.text().catch(() => "");
				return { id, ok: false, latencyMs, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
			} catch (e) {
				return { id, ok: false, latencyMs: Date.now() - started, error: (e as Error).message };
			} finally {
				clearTimeout(timer);
			}
		}
		const { url, headers, body } = buildTestRequest(rec.type as ProviderKind, rec);
		const started = Date.now();
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: ctrl.signal,
			});
			const latencyMs = Date.now() - started;
			if (res.ok) return { id, ok: true, latencyMs, error: null };
			const text = await res.text().catch(() => "");
			return { id, ok: false, latencyMs, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
		} catch (e) {
			return { id, ok: false, latencyMs: Date.now() - started, error: (e as Error).message };
		} finally {
			clearTimeout(timer);
		}
	}

	private async resolve(configDir: string, id: string): Promise<ProviderRecord> {
		const ctx = await loadWorkspaceContext(configDir, configDir);
		// Prefer the workspace-local row; fall back to the global sentinel.
		const local = this.providerRepo.get(id, ctx.id);
		if (local) return local;
		const global = this.providerRepo.get(id, GLOBAL_WORKSPACE_ID);
		if (global) return global;
		throw new ProviderNotFoundError(id);
	}
}

// ---------------------------------------------------------------------------
// Pure transforms (also reused by tests / external callers if needed)
// ---------------------------------------------------------------------------

function mergeWithLocalWins(rows: ProviderRecord[]): ProviderSourceRecord[] {
	const byId = new Map<string, ProviderSourceRecord>();
	for (const r of rows) {
		const existing = byId.get(r.id);
		if (!existing || existing.source !== "local") {
			byId.set(r.id, toSourceRecord(r));
		}
	}
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function toSourceRecord(rec: ProviderRecord): ProviderSourceRecord {
	return {
		...rec,
		source: rec.workspaceId === GLOBAL_WORKSPACE_ID ? "global" : "local",
	};
}

function toSummary(rec: ProviderSourceRecord): ProviderSummary {
	return {
		id: rec.id,
		type: rec.type as ProviderKind,
		name: rec.name,
		source: rec.source,
		baseUrl: rec.baseUrl,
		defaultModel: rec.defaultModel,
		hasApiKey: rec.apiKey.length > 0,
		createdAt: new Date(rec.createdAt).toISOString(),
		updatedAt: new Date(rec.updatedAt).toISOString(),
	};
}

function toDetail(rec: ProviderSourceRecord): ProviderDetail {
	return {
		...toSummary(rec),
		apiKeyMasked: maskKey(rec.apiKey),
	};
}

// Silence "unused import" if config becomes unused in some future pruning pass.
void config;
