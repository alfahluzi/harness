import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useActiveWorkdir } from "./use-active-workdir";

const STALE_MS = 30_000;

export function useSkills() {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["skills", configDir],
		queryFn: () => api.skills.list(configDir),
		enabled: configDir.length > 0,
		staleTime: STALE_MS,
	});
}

export function useSkill(name: string | null) {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["skill", configDir, name],
		queryFn: () => {
			if (!name) throw new Error("name required");
			return api.skills.get(configDir, name);
		},
		enabled: configDir.length > 0 && !!name,
		staleTime: STALE_MS,
	});
}