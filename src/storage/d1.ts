import type { SqlDriver, SqlValue } from "./sql.js";

/** SqlDriver over a Cloudflare D1 binding (SQLite at the edge). */
export function d1Driver(db: D1Database): SqlDriver {
  return {
    async run(sql: string, params: SqlValue[] = []) {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: r.meta.changes ?? 0 };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      const r = await db.prepare(sql).bind(...params).all<T>();
      return r.results;
    },
  };
}
