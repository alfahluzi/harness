// SQLite persistence for the backend session manager.
//
// Uses Bun's built-in `bun:sqlite` (no native build, no extra deps).
// Source of truth for the task registry — survives restarts.
//
// Storage location: ./data/backend.db by default, override with
// SQLITE_PATH or BACKEND_DB_PATH. WAL mode for concurrent reads.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = resolve(
	process.env.SQLITE_PATH ?? process.env.BACKEND_DB_PATH ?? "./data/backend.db",
);

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
	CREATE TABLE IF NOT EXISTS tasks (
		id                  TEXT PRIMARY KEY,
		description         TEXT NOT NULL,
		parent_thread_id    TEXT,
		child_thread_id     TEXT NOT NULL,
		run_id              TEXT,
		agent_profile       TEXT NOT NULL,
		background          INTEGER NOT NULL,
		status              TEXT NOT NULL,
		created_at          INTEGER NOT NULL,
		completed_at        INTEGER,
		result_json         TEXT,
		error               TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
	CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
`);
