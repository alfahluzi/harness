import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// Workspace sentinel used when a provider is connected with `target: "global"`.
// Rows with workspace_id = GLOBAL_WORKSPACE_ID are visible to every workspace
// (local rows shadow them via the merge layer in ProviderRepository).
export const GLOBAL_WORKSPACE_ID = "__global__";

export const providers = sqliteTable(
	"providers",
	{
		id: text("id").notNull(),
		workspaceId: text("workspace_id").notNull(),
		type: text("type").notNull(),
		name: text("name").notNull(),
		baseUrl: text("base_url").notNull(),
		// api_key is stored server-side so the runtime can use it. The API
		// surface never returns this value — only a masked preview.
		apiKey: text("api_key").notNull(),
		defaultModel: text("default_model").notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.id, t.workspaceId] }),
		workspaceIdx: index("providers_workspace_idx").on(t.workspaceId),
	}),
);

export type ProviderRow = typeof providers.$inferSelect;
export type ProviderInsert = typeof providers.$inferInsert;
