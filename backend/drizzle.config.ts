import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

// Shared with agent/ — see src/global/db.ts. Drizzle scripts run from
// backend/ (see package.json db:*), so repo root is one level up.
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/models/*.ts",
	dbCredentials: {
		url: resolve(
			process.env.SQLITE_PATH ??
				process.env.BACKEND_DB_PATH ??
				process.cwd() + "/../data/shared.db",
		),
	},
});
