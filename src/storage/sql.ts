import type { CheckKind, StreamCheck } from "../domain/types.js";
import type { LatestChecks, Store } from "./types.js";

export type SqlValue = string | number | null;

/** The few operations the store needs, implemented over node:sqlite and Cloudflare D1. */
export interface SqlDriver {
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close?(): Promise<void>;
}

/** Schema migrations, applied in order. Never edit a released entry; append a new one. */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS stream_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('probe', 'playback')),
      ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
      checked_at INTEGER NOT NULL,
      location TEXT,
      stream_host TEXT,
      detail TEXT NOT NULL DEFAULT '{}',
      error TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_checks_item_kind ON stream_checks (item_id, kind, checked_at)`,
  ],
];

interface CheckRow {
  id: number;
  item_id: string;
  provider: string;
  kind: CheckKind;
  ok: number;
  checked_at: number;
  location: string | null;
  stream_host: string | null;
  detail: string;
  error: string | null;
}

function fromRow(r: CheckRow): StreamCheck {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(r.detail) as Record<string, unknown>;
  } catch {
    detail = { unparsable: r.detail };
  }
  return {
    itemId: r.item_id,
    provider: r.provider,
    kind: r.kind,
    ok: r.ok === 1,
    checkedAt: r.checked_at,
    location: r.location ?? undefined,
    streamHost: r.stream_host ?? undefined,
    detail,
    error: r.error ?? undefined,
  };
}

export class SqlStore implements Store {
  constructor(private readonly db: SqlDriver) {}

  async init(): Promise<void> {
    await this.db.run(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
    const rows = await this.db.all<{ v: number | null }>(`SELECT MAX(version) AS v FROM schema_version`);
    const current = rows[0]?.v ?? 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
      for (const stmt of MIGRATIONS[v]!) await this.db.run(stmt);
      await this.db.run(`INSERT INTO schema_version (version) VALUES (?)`, [v + 1]);
    }
  }

  async recordCheck(c: StreamCheck): Promise<void> {
    await this.db.run(
      `INSERT INTO stream_checks (item_id, provider, kind, ok, checked_at, location, stream_host, detail, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.itemId, c.provider, c.kind, c.ok ? 1 : 0, c.checkedAt, c.location ?? null, c.streamHost ?? null, JSON.stringify(c.detail), c.error ?? null],
    );
  }

  async latestChecks(): Promise<Map<string, LatestChecks>> {
    const rows = await this.db.all<CheckRow>(
      `SELECT * FROM stream_checks WHERE id IN (SELECT MAX(id) FROM stream_checks GROUP BY item_id, kind)`,
    );
    const out = new Map<string, LatestChecks>();
    for (const row of rows) {
      const c = fromRow(row);
      const entry = out.get(c.itemId) ?? {};
      entry[c.kind] = c;
      out.set(c.itemId, entry);
    }
    return out;
  }

  async history(itemId: string, kind: CheckKind, limit: number): Promise<StreamCheck[]> {
    const rows = await this.db.all<CheckRow>(
      `SELECT * FROM stream_checks WHERE item_id = ? AND kind = ? ORDER BY checked_at DESC, id DESC LIMIT ?`,
      [itemId, kind, limit],
    );
    return rows.map(fromRow);
  }

  async prune(olderThan: number): Promise<number> {
    const res = await this.db.run(
      `DELETE FROM stream_checks WHERE checked_at < ?
       AND id NOT IN (SELECT MAX(id) FROM stream_checks GROUP BY item_id, kind)`,
      [olderThan],
    );
    return res.changes;
  }

  async close(): Promise<void> {
    await this.db.close?.();
  }
}
