import { useEffect, useState } from "react";
import { useAgents } from "@/hooks/use-agents";
import { useProviders, useProviderModels } from "@/hooks/use-providers";
import type { AgentSummary, ProviderModel } from "@/lib/api";

const AGENT_KEY = "puna:agent";
const MODEL_KEY = "puna:model";

export type AgentProfile = AgentSummary & {
	providerId?: string | null;
	modelId?: string | null;
};

function readStored(key: string, fallback: string): string {
	if (typeof window === "undefined") return fallback;
	try {
		return window.localStorage.getItem(key) || fallback;
	} catch {
		return fallback;
	}
}

function writeStored(key: string, value: string) {
	if (typeof window === "undefined") return;
	try {
		if (value) window.localStorage.setItem(key, value);
		else window.localStorage.removeItem(key);
	} catch {
		// ignore storage errors
	}
}

export function useAgentModelSelection() {
	const agentsQuery = useAgents();
	const providersQuery = useProviders();

	const rawAgents = (agentsQuery.data?.agents ?? []) as AgentProfile[];
	const providers = providersQuery.data?.providers ?? [];

	const [agentProfile, setAgentProfile] = useState(() =>
		readStored(AGENT_KEY, ""),
	);
	const [model, setModel] = useState(() => readStored(MODEL_KEY, ""));

	const activeAgent =
		rawAgents.find((a) => a.name === agentProfile) ?? rawAgents[0];
	const fallbackProviderId = providers[0]?.id ?? null;
	const providerId = activeAgent?.providerId ?? fallbackProviderId;

	const modelsQuery = useProviderModels(providerId);
	const models = (modelsQuery.data?.models ?? []) as ProviderModel[];

	// Initialize agent from stored value or first available.
	useEffect(() => {
		if (rawAgents.length === 0) return;
		const stored = readStored(AGENT_KEY, "");
		const valid = rawAgents.find((a) => a.name === stored);
		const next = valid ? valid.name : rawAgents[0].name;
		setAgentProfile((current) => (current === next ? current : next));
	}, [rawAgents]);

	// When agent changes, reset model to agent default or first available model.
	useEffect(() => {
		if (models.length === 0) {
			setModel((current) => (current === "" ? current : ""));
			return;
		}
		const preferred = activeAgent?.modelId;
		const match = preferred
			? models.find((m) => m.modelId === preferred)
			: undefined;
		const next = match ? match.modelId : models[0].modelId;
		setModel((current) => (current === next ? current : next));
	}, [activeAgent, models]);

	// Persist selections.
	useEffect(() => {
		writeStored(AGENT_KEY, agentProfile);
	}, [agentProfile]);

	useEffect(() => {
		writeStored(MODEL_KEY, model);
	}, [model]);

	let modelStatus: string | null = null;
	if (!activeAgent) {
		modelStatus = "No agents available";
	} else if (!providerId) {
		modelStatus = "Agent has no provider";
	} else if (modelsQuery.isLoading) {
		modelStatus = "Loading models…";
	} else if (models.length === 0) {
		modelStatus = "No models found";
	}

return {
		agentProfile,
		setAgentProfile,
		model,
		setModel,
		agents: rawAgents,
		models,
		activeAgent,
		providerId,
		hasProvider: providerId !== null,
		modelStatus,
		isLoadingAgents: agentsQuery.isLoading,
	};
}
