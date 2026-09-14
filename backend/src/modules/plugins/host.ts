import type { PluginSummary } from "@puna/sdk-shared";

/**
 * Plugin host — singleton wired into `server.ts` boot (Fase 4).
 *
 * Fase 1 stub: holds loaded summaries, methods are placeholders that will
 * be implemented when F4-T1 (`discoverAndLoad`) lands.
 */
export class PluginHost {
	private loaded = new Map<string, PluginSummary>();

	/** Replace the loaded set (called by F4-T1 `discoverAndLoad`). */
	setLoaded(summaries: PluginSummary[]): void {
		const next = new Map<string, PluginSummary>();
		for (const summary of [...summaries].sort((a, b) => a.id.localeCompare(b.id))) {
			if (!next.has(summary.id)) next.set(summary.id, summary);
		}
		this.loaded = next;
	}

	list(): PluginSummary[] {
		return [...this.loaded.values()];
	}

	get(id: string): PluginSummary | undefined {
		return this.loaded.get(id);
	}

	// Fase 4+ will implement these:
	getLifecycleHooks(): unknown[] {
		return [];
	}

	getTools(): unknown[] {
		return [];
	}

	getGraphs(): Record<string, unknown> {
		return {};
	}

	getSystemPromptTransformers(): unknown[] {
		return [];
	}
}

/**
 * Module-level singleton. Lazily constructed; the same instance is shared by
 * `server.ts` boot (Fase 4) and the plugin routes (Fase 1 list uses it as
 * a read-side cache after `setLoaded` is called).
 */
export const pluginHost = new PluginHost();
