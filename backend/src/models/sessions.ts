import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
	"sessions",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id").notNull(),
		description: text("description").notNull(),
		parentThreadId: text("parent_thread_id"),
		childThreadId: text("child_thread_id").notNull(),
		runId: text("run_id"),
		background: integer("background", { mode: "boolean" }).notNull(),
		configDir: text("config_dir").notNull().default(""),
		model: text("model"),
		status: text("status").notNull(),
		createdAt: integer("created_at").notNull(),
		completedAt: integer("completed_at"),
		resultJson: text("result_json"),
		error: text("error"),
		activeCheckpointId: text("active_checkpoint_id"),
	},
	(t) => ({
		workspaceIdx: index("sessions_workspace_idx").on(t.workspaceId),
	}),
);
