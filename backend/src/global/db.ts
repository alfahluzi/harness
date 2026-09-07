import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "../models/sessions";

const DB_PATH = resolve(
	process.env.SQLITE_PATH ?? process.env.BACKEND_DB_PATH ?? "./data/backend.db",
);

mkdirSync(dirname(DB_PATH), { recursive: true });

/** Raw bun:sqlite Database — used by repository (prepared statements). */
export const sqliteDb = new Database(DB_PATH, { create: true });
sqliteDb.run("PRAGMA journal_mode = WAL;");
sqliteDb.run("PRAGMA foreign_keys = ON;");

/** Drizzle ORM instance — type-safe queries via schema. */
export const db = drizzle(sqliteDb, { schema });
