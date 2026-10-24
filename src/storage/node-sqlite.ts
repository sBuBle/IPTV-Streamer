import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue } from "./sql.js";

/** SqlDriver over Node's built-in SQLite (Node >= 22.13). */
export function openNodeSqlite(path: string): SqlDriver {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    async run(sql: string, params: SqlValue[] = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async close() {
      db.close();
    },
  };
}
