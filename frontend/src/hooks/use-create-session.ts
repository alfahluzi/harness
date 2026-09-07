import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postApiSessions, type CreateSessionInput } from "@/lib/api";

// Backend create returns { sessionId, thread_id, status }, but the OpenAPI
// response schema is z.any() (untyped) so we pin the shape here.
type CreateSessionResult = {
	sessionId: string;
	thread_id?: string;
	status?: string;
};

// The backend now requires configDir in the create body, but the generated
// OpenAPI type has not been refreshed yet. We extend it and cast at the API
// boundary so the route stays type-safe.
type CreateSessionInputExtended = CreateSessionInput & {
	configDir: string;
	agentProfile?: string;
	model?: string;
};

export function useCreateSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: CreateSessionInputExtended) =>
			postApiSessions({
				body: input as CreateSessionInput,
				throwOnError: true,
			}).then((r) => r.data as CreateSessionResult),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: ["sessions", variables.workspaceId],
			});
		},
	});
}
