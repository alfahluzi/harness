import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/models/sessions.ts",
	dbCredentials: {
		url: process.env.SQLITE_PATH ?? process.env.BACKEND_DB_PATH ?? "./data/backend.db",
	},
});
