import { sqliteTable, text, integer, index, primaryKey, foreignKey } from "drizzle-orm/sqlite-core";
import { providers } from "./providers";

// `provider_id + workspace_id` is a composite FK to providers(id, workspace_id).
// The FK uses ON DELETE CASCADE so deleting a provider automatically removes
// its synced models. The PK order is (workspace_id, provider_id, model_id) so
// the FK index can be the leftmost prefix of the PK — required by SQLite for
// cascading deletes via foreign keys.
export const providerModels = sqliteTable(
	"provider_models",
	{
		workspaceId: text("workspace_id").notNull(),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		name: text("name"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.workspaceId, t.providerId, t.modelId] }),
		providerIdx: index("provider_models_provider_idx").on(t.workspaceId, t.providerId),
		providerFk: foreignKey({
			columns: [t.workspaceId, t.providerId],
			foreignColumns: [providers.workspaceId, providers.id],
			name: "provider_models_provider_fk",
		}).onDelete("cascade"),
	}),
);

export type ProviderModelRow = typeof providerModels.$inferSelect;
export type ProviderModelInsert = typeof providerModels.$inferInsert;
