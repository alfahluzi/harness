import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useActiveWorkdir } from "./use-active-workdir";

const STALE_MS = 30_000;

export function useAgents() {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["agents", configDir],
		queryFn: () => api.agents.list(configDir),
		enabled: configDir.length > 0,
		staleTime: STALE_MS,
	});
}

export function useAgent(name: string | null) {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["agent", configDir, name],
		queryFn: () => {
			if (!name) throw new Error("name required");
			return api.agents.get(configDir, name);
		},
		enabled: configDir.length > 0 && !!name,
		staleTime: STALE_MS,
	});
}