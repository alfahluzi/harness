import type { ProviderType } from "@/lib/ui-types";

export interface ProviderCatalogEntry {
	label: string;
	keyPlaceholder: string;
	baseUrl: string;
	badge: string;
	dot: string;
}

export const PROVIDER_CATALOG: Record<ProviderType, ProviderCatalogEntry> = {
	openai: {
		label: "OpenAI",
		keyPlaceholder: "sk-…",
		baseUrl: "https://api.openai.com/v1",
		badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
		dot: "bg-emerald-500",
	},
	anthropic: {
		label: "Anthropic",
		keyPlaceholder: "sk-ant-…",
		baseUrl: "https://api.anthropic.com",
		badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
		dot: "bg-amber-500",
	},
	google: {
		label: "Google",
		keyPlaceholder: "AIza…",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
		dot: "bg-blue-500",
	},
	openrouter: {
		label: "OpenRouter",
		keyPlaceholder: "sk-or-…",
		baseUrl: "https://openrouter.ai/api/v1",
		badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
		dot: "bg-purple-500",
	},
	custom: {
		label: "Custom",
		keyPlaceholder: "sk-… or token",
		baseUrl: "",
		badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
		dot: "bg-cyan-500",
	},
};