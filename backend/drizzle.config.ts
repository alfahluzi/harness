import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

// Shared with agent/ — see src/global/db.ts. DB path is anchored to script
// dir (backend/) so it stays correct regardless of CWD (root `bun install`
// may invoke drizzle-kit from anywhere).
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/models/*.ts",
	dbCredentials: {
		url: resolve(
			import.meta.dir,
			process.env.SQLITE_PATH ??
				process.env.BACKEND_DB_PATH ??
				"../data/shared.db",
		),
	},
});
