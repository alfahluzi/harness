import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
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
		queryFn: () => api.mcps.search(debounced),
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
			return api.mcps.registryDetail(name);
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
		queryFn: () => api.mcps.listInstalled(configDir),
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
			return api.mcps.getInstalled(configDir, name);
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
			api.mcps.install(configDir, body),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["installed-mcps", configDir] });
		},
	});
}

export function useUninstallMcp() {
	const { configDir } = useActiveWorkdir();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => api.mcps.uninstall(configDir, name),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["installed-mcps", configDir] });
			qc.invalidateQueries({ queryKey: ["installed-mcp-detail", configDir] });
		},
	});
}