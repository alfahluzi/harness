import { defineConfig } from "drizzle-kit";

// Shared with agent/ — see src/global/db.ts.
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/models/sessions.ts",
	dbCredentials: {
		url: process.env.SQLITE_PATH ?? process.env.BACKEND_DB_PATH ?? "../../data/shared.db",
	},
});
