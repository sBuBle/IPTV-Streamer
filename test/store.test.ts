import { describe, expect, it } from "vitest";
import type { StreamCheck } from "../src/domain/types.js";
import { MemoryStore } from "../src/storage/memory.js";
import { openNodeSqlite } from "../src/storage/node-sqlite.js";
import { SqlStore } from "../src/storage/sql.js";
import type { Store } from "../src/storage/types.js";

const check = (over: Partial<StreamCheck>): StreamCheck => ({
  itemId: "iltv:live:p:a",
  provider: "p",
  kind: "probe",
  ok: true,
  checkedAt: 1000,
  detail: {},
  ...over,
});

const stores: Array<[string, () => Store]> = [
  ["MemoryStore", () => new MemoryStore()],
  ["SqlStore (node:sqlite)", () => new SqlStore(openNodeSqlite(":memory:"))],
];

describe.each(stores)("%s", (_name, make) => {
  it("returns the latest check of each kind per item", async () => {
    const s = make();
    await s.init();
    await s.init(); // migrations are idempotent
    await s.recordCheck(check({ checkedAt: 1000, ok: true }));
    await s.recordCheck(check({ checkedAt: 2000, ok: false, error: "boom", location: "IL", detail: { stage: "segment" } }));
    await s.recordCheck(check({ kind: "playback", checkedAt: 1500 }));
    await s.recordCheck(check({ itemId: "iltv:live:p:b", checkedAt: 500 }));
    const latest = await s.latestChecks();
    expect(latest.get("iltv:live:p:a")?.probe).toMatchObject({ ok: false, error: "boom", location: "IL", detail: { stage: "segment" } });
    expect(latest.get("iltv:live:p:a")?.playback?.checkedAt).toBe(1500);
    expect(latest.get("iltv:live:p:b")?.probe?.checkedAt).toBe(500);
    expect((await s.history("iltv:live:p:a", "probe", 10)).map((c) => c.checkedAt)).toEqual([2000, 1000]);
  });

  it("prunes old checks but keeps the latest ones", async () => {
    const s = make();
    await s.init();
    await s.recordCheck(check({ checkedAt: 100 }));
    await s.recordCheck(check({ checkedAt: 200 }));
    await s.recordCheck(check({ itemId: "iltv:live:p:old", checkedAt: 50 }));
    expect(await s.prune(1000)).toBe(1);
    const latest = await s.latestChecks();
    expect(latest.get("iltv:live:p:a")?.probe?.checkedAt).toBe(200);
    expect(latest.get("iltv:live:p:old")?.probe?.checkedAt).toBe(50);
  });
});
