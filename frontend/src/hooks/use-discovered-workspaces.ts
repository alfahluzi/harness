import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const STALE_MS = 60_000;

export function useDiscoveredWorkspaces(root?: string) {
	return useQuery({
		queryKey: ["workspaces", "discover", root ?? "~"],
		queryFn: () => api.workspaces.discover(root),
		staleTime: STALE_MS,
		retry: 1,
	});
}