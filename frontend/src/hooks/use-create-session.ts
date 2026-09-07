import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postApiSessions, type CreateSessionInput } from "@/lib/api";

// Backend create returns { sessionId, thread_id, status }, but the OpenAPI
// response schema is z.any() (untyped) so we pin the shape here.
type CreateSessionResult = {
	sessionId: string;
	thread_id?: string;
	status?: string;
};

export function useCreateSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: CreateSessionInput) =>
			postApiSessions({ body: input, throwOnError: true }).then(
				(r) => r.data as CreateSessionResult,
			),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({ queryKey: ["sessions", variables.workspaceId] });
		},
	});
}
