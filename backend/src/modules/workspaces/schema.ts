import { z } from "zod";

export const DiscoverRootQuery = z.object({
	root: z.string().optional(),
});

export const DiscoveredWorkspace = z
	.object({
		path: z.string(),
		id: z.string().nullable(),
	})
	.openapi("DiscoveredWorkspace");
export type DiscoveredWorkspace = z.infer<typeof DiscoveredWorkspace>;

export const WorkspacesDiscoverResponse = z
	.object({
		root: z.string(),
		workspaces: z.array(DiscoveredWorkspace),
	})
	.openapi("WorkspacesDiscoverResponse");
export type WorkspacesDiscoverResponse = z.infer<typeof WorkspacesDiscoverResponse>;

export const ErrorResponse = z.object({ error: z.string() }).openapi("Error");
export type ErrorResponse = z.infer<typeof ErrorResponse>;