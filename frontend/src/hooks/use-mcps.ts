import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	deleteApiMcpsInstalledName,
	getApiMcpsInstalled,
	getApiMcpsInstalledName,
	getApiMcpsRegistryName,
	getApiMcpsSearch,
	postApiMcpsInstall,
} from "@/lib/api";
import { useActiveWorkdir } from "./use-active-workdir";

const STALE_MS = 30_000;

function useDebounced<T>(value: T, ms: number): T {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

export function useMcpSearch(query: string) {
	const debounced = useDebounced(query.trim(), 350);
	return useQuery({
		queryKey: ["mcp-search", debounced],
		queryFn: () =>
			getApiMcpsSearch({ query: { q: debounced }, throwOnError: true }).then((r) => r.data),
		enabled: debounced.length >= 2,
		staleTime: STALE_MS,
		retry: 1,
	});
}

export function usePublicMcpDetail(name: string | null) {
	return useQuery({
		queryKey: ["mcp-public-detail", name],
		queryFn: () => {
			if (!name) throw new Error("name required");
			return getApiMcpsRegistryName({ path: { name }, throwOnError: true }).then((r) => r.data);
		},
		enabled: !!name,
		staleTime: STALE_MS,
		retry: 1,
	});
}

export function useInstalledMcps() {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["installed-mcps", configDir],
		queryFn: () =>
			getApiMcpsInstalled({ query: { configDir }, throwOnError: true }).then((r) => r.data),
		enabled: configDir.length > 0,
		staleTime: STALE_MS,
	});
}

export function useInstalledMcpDetail(name: string | null) {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["installed-mcp-detail", configDir, name],
		queryFn: () => {
			if (!name) throw new Error("name required");
			return getApiMcpsInstalledName({
				path: { name },
				query: { configDir },
				throwOnError: true,
			}).then((r) => r.data);
		},
		enabled: configDir.length > 0 && !!name,
		staleTime: STALE_MS,
	});
}

export function useInstallMcp() {
	const { configDir } = useActiveWorkdir();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: { name: string; version?: string; target?: "local" | "global" }) =>
			postApiMcpsInstall({ query: { configDir }, body, throwOnError: true }).then((r) => r.data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["installed-mcps", configDir] });
		},
	});
}

export function useUninstallMcp() {
	const { configDir } = useActiveWorkdir();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (name: string) =>
			deleteApiMcpsInstalledName({
				path: { name },
				query: { configDir },
				throwOnError: true,
			}).then((r) => r.data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["installed-mcps", configDir] });
			qc.invalidateQueries({ queryKey: ["installed-mcp-detail", configDir] });
		},
	});
}
