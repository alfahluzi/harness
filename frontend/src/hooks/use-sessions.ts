import { useQuery } from "@tanstack/react-query";
import { getApiSessions } from "@/lib/api";
import { useActiveWorkdir } from "./use-active-workdir";

const STALE_MS = 5_000;

export function useSessions() {
	const { configDir } = useActiveWorkdir();
	return useQuery({
		queryKey: ["sessions", configDir],
		queryFn: () =>
			getApiSessions({
				query: { workspaceId: configDir },
				throwOnError: true,
			}).then((r) => r.data),
		enabled: configDir.length > 0,
		staleTime: STALE_MS,
		refetchInterval: STALE_MS,
	});
}
