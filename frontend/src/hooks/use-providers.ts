import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	deleteApiProvidersId,
	getApiProviders,
	getApiProvidersId,
	getApiProvidersIdModels,
	postApiProvidersConnect,
	postApiProvidersTest,
	putApiProvidersId,
} from "@/lib/api";
import type { ProviderType } from "@/lib/ui-types";
import { useActiveWorkdir } from "./use-active-workdir";

const STALE_MS = 30_000;

export function useProviders() {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["providers", configDir],
		queryFn: () =>
			getApiProviders({ query: { configDir }, throwOnError: true }).then((r) => r.data),
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
			return getApiProvidersId({ path: { id }, query: { configDir }, throwOnError: true }).then(
				(r) => r.data,
			);
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
			return getApiProvidersIdModels({
				path: { id },
				query: { configDir },
				throwOnError: true,
			}).then((r) => r.data);
		},
		enabled: configDir.length > 0 && !!id,
		staleTime: STALE_MS,
	});
}

export function useTestProviderCredentials() {
	const { configDir } = useActiveWorkdir();
	return useMutation({
		mutationFn: (body: { type: ProviderType; apiKey?: string; baseUrl?: string }) =>
			postApiProvidersTest({ query: { configDir }, body, throwOnError: true }).then(
				(r) => r.data,
			),
	});
}

export function useConnectProvider() {
	const { configDir } = useActiveWorkdir();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: {
			type: ProviderType;
			apiKey: string;
			name?: string;
			baseUrl?: string;
			target?: "local" | "global";
		}) =>
			postApiProvidersConnect({ query: { configDir }, body, throwOnError: true }).then(
				(r) => r.data,
			),
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
		mutationFn: ({
			id,
			body,
		}: {
			id: string;
			body: { name?: string; apiKey?: string; baseUrl?: string };
		}) =>
			putApiProvidersId({ path: { id }, query: { configDir }, body, throwOnError: true }).then(
				(r) => r.data,
			),
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
		mutationFn: (id: string) =>
			deleteApiProvidersId({ path: { id }, query: { configDir }, throwOnError: true }).then(
				(r) => r.data,
			),
		onSuccess: (_data, id) => {
			qc.invalidateQueries({ queryKey: ["providers", configDir] });
			qc.invalidateQueries({ queryKey: ["provider", configDir, id] });
			qc.invalidateQueries({ queryKey: ["provider-models", configDir, id] });
		},
	});
}
