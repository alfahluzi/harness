import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type {
	ProviderConnectInput,
	ProviderTestInput,
	ProviderUpdateInput,
} from "../types/puna";
import { useActiveWorkdir } from "./use-active-workdir";

const STALE_MS = 30_000;

export function useProviders() {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["providers", configDir],
		queryFn: () => api.providers.list(configDir),
		enabled: configDir.length > 0,
		staleTime: STALE_MS,
	});
}

export function useProvider(id: string | null) {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["provider", configDir, id],
		queryFn: () => {
			if (!id) throw new Error("id required");
			return api.providers.get(configDir, id);
		},
		enabled: configDir.length > 0 && !!id,
		staleTime: STALE_MS,
	});
}

export function useProviderModels(id: string | null) {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["provider-models", configDir, id],
		queryFn: () => {
			if (!id) throw new Error("id required");
			return api.providers.models(configDir, id);
		},
		enabled: configDir.length > 0 && !!id,
		staleTime: STALE_MS,
	});
}

export function useTestProviderCredentials() {
	const { configDir } = useActiveWorkdir();
	return useMutation({
		mutationFn: (body: ProviderTestInput) => api.providers.test(configDir, body),
	});
}

export function useConnectProvider() {
	const { configDir } = useActiveWorkdir();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: ProviderConnectInput) => api.providers.connect(configDir, body),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ["providers", configDir] });
			qc.invalidateQueries({ queryKey: ["provider", configDir, variables.type] });
			qc.invalidateQueries({ queryKey: ["provider-models", configDir, variables.type] });
		},
	});
}

export function useUpdateProvider() {
	const { configDir } = useActiveWorkdir();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, body }: { id: string; body: ProviderUpdateInput }) =>
			api.providers.update(configDir, id, body),
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ["providers", configDir] });
			qc.invalidateQueries({ queryKey: ["provider", configDir, variables.id] });
			qc.invalidateQueries({ queryKey: ["provider-models", configDir, variables.id] });
		},
	});
}

export function useDisconnectProvider() {
	const { configDir } = useActiveWorkdir();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.providers.disconnect(configDir, id),
		onSuccess: (_data, id) => {
			qc.invalidateQueries({ queryKey: ["providers", configDir] });
			qc.invalidateQueries({ queryKey: ["provider", configDir, id] });
			qc.invalidateQueries({ queryKey: ["provider-models", configDir, id] });
		},
	});
}
