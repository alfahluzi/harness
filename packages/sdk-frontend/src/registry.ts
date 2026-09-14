/**
 * Registry client — fetches the plugin list, then hydrates each entry with its
 * full manifest so slot hooks can read `capabilities`.
 *
 * Backend contract:
 *   GET /api/plugins?configDir=<path>
 *     → { workspaceId, globalConfigDir, plugins: PluginSummary[] }
 *   GET /api/plugins/<id>?configDir=<path>
 *     → { manifest: PluginManifest, source, resolvedDir }
 *
 * There is no aggregate endpoint; detail fetches run in parallel and are
 * best-effort (`Promise.allSettled`): a failed manifest keeps the summary with
 * `capabilities: {}` instead of dropping the plugin or failing the batch.
 */
import type { PluginCapabilities, PluginSummary } from "@puna/sdk-shared";

/**
 * Capability keys that carry a frontend UI entry today.
 * `backendHooks` / `tools` / `graphs` are backend-side and intentionally absent.
 */
export type PluginCapabilityKey =
	| "leftBar"
	| "footerBar"
	| "chatRenderers"
	| "toolUi";

export type RegisteredPlugin = {
	summary: PluginSummary;
	capabilities: PluginCapabilities;
};

export type RegistryState = {
	plugins: Map<string, RegisteredPlugin>;
	loading: boolean;
	error: Error | null;
};

export type RegistryClient = {
	fetchAll(configDir: string): Promise<RegistryState>;
};

export type RegistryClientOptions = {
	/** Injectable fetch for tests / non-browser hosts. Defaults to global fetch. */
	fetchImpl?: typeof fetch;
	/** Base URL of the plugins API (no trailing slash). Default `/api/plugins`. */
	baseUrl?: string;
};

type PluginsListResponse = {
	plugins?: PluginSummary[];
};

type PluginDetailResponse = {
	manifest?: {
		capabilities?: PluginCapabilities;
	};
};

/** Stable empty state — shared so consumers can compare by reference if needed. */
export const EMPTY_REGISTRY: RegistryState = {
	plugins: new Map(),
	loading: false,
	error: null,
};

function toPluginUrl(baseUrl: string, configDir: string, id?: string): string {
	const suffix = id ? `/${encodeURIComponent(id)}` : "";
	return `${baseUrl}${suffix}?configDir=${encodeURIComponent(configDir)}`;
}

function toError(cause: unknown): Error {
	return cause instanceof Error ? cause : new Error(String(cause));
}

export function createRegistryClient({
	fetchImpl,
	baseUrl = "/api/plugins",
}: RegistryClientOptions = {}): RegistryClient {
	const doFetch: typeof fetch = fetchImpl ?? fetch;

	async function fetchCapabilities(
		configDir: string,
		id: string,
	): Promise<PluginCapabilities> {
		const url = toPluginUrl(baseUrl, configDir, id);
		const res = await doFetch(url, { headers: { accept: "application/json" } });
		if (!res.ok) {
			throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
		}
		const body = (await res.json()) as PluginDetailResponse;
		return body.manifest?.capabilities ?? {};
	}

	async function fetchAll(configDir: string): Promise<RegistryState> {
		if (!configDir) return EMPTY_REGISTRY;

		const listUrl = toPluginUrl(baseUrl, configDir);
		let summaries: PluginSummary[];
		try {
			const res = await doFetch(listUrl, {
				headers: { accept: "application/json" },
			});
			if (!res.ok) {
				throw new Error(`GET ${listUrl} failed: ${res.status} ${res.statusText}`);
			}
			const body = (await res.json()) as PluginsListResponse;
			summaries = body.plugins ?? [];
		} catch (cause) {
			return { plugins: new Map(), loading: false, error: toError(cause) };
		}

		const results = await Promise.allSettled(
			summaries.map((summary) => fetchCapabilities(configDir, summary.id)),
		);

		const plugins = new Map<string, RegisteredPlugin>();
		summaries.forEach((summary, index) => {
			const result = results[index];
			if (!result) return;
			if (result.status === "rejected") {
				console.warn(
					`[puna:plugins] capability fetch failed for "${summary.id}"`,
					result.reason,
				);
			}
			plugins.set(summary.id, {
				summary,
				capabilities: result.status === "fulfilled" ? result.value : {},
			});
		});

		return { plugins, loading: false, error: null };
	}

	return { fetchAll };
}
