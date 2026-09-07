import { useQuery } from "@tanstack/react-query";
import { getApiWorkspacesDiscover } from "@/lib/api";

const STALE_MS = 60_000;

export function useDiscoveredWorkspaces(root?: string) {
	return useQuery({
		queryKey: ["workspaces", "discover", root ?? "~"],
		queryFn: () =>
			getApiWorkspacesDiscover({ query: { root }, throwOnError: true }).then((r) => r.data),
		staleTime: STALE_MS,
		retry: 1,
	});
}
