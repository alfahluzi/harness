import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "../models";

// Shared with agent/ — both apps write to the same file at workspace root.
// Anchored to this file (backend/src/global -> repo root), not CWD, so the
// path is identical no matter where the process is launched from.
const DB_PATH = resolve(
	process.env.SQLITE_PATH ??
		process.env.BACKEND_DB_PATH ??
		import.meta.dirname + "/../../../data/shared.db",
);

mkdirSync(dirname(DB_PATH), { recursive: true });

/** Raw bun:sqlite Database — used by repository (prepared statements). */
export const sqliteDb = new Database(DB_PATH, { create: true });
sqliteDb.run("PRAGMA journal_mode = WAL;");
sqliteDb.run("PRAGMA foreign_keys = ON;");

/** Drizzle ORM instance — type-safe queries via schema. */
export const db = drizzle(sqliteDb, { schema });
