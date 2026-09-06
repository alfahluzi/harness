// SqliteSaver checkpointer for the LangGraph graph.
//
// Persists thread/checkpoint state to a local SQLite file so agent runs
// survive process restarts. The CLI dev server picks this up via the import
// from `./graph.ts`.
//
// Storage location: ./data/checkpoints.db by default, override with
// SQLITE_CHECKPOINT_PATH. WAL mode is enabled for concurrent reads while a
// run is in flight.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

const DB_PATH = resolve(
	process.env.SQLITE_CHECKPOINT_PATH ?? "./data/checkpoints.db",
);

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export const checkpointer = new SqliteSaver(db);
