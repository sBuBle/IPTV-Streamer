import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/util/cache.js";

describe("TtlCache", () => {
  it("coalesces concurrent loads", async () => {
    const cache = new TtlCache<number>();
    let loads = 0;
    const load = async () => ({ value: ++loads, ttlMs: 1000 });
    expect(await Promise.all([cache.getOrLoad("k", load), cache.getOrLoad("k", load)])).toEqual([1, 1]);
    expect(loads).toBe(1);
  });

  it("serves the remembered value while reloading an expired key in the background", async () => {
    let now = 0;
    const cache = new TtlCache<string>(10, () => now);
    let release!: (v: { value: string; ttlMs: number }) => void;
    cache.remember("k", "old");
    cache.set("k", "old", 1000);
    now = 2000;
    const slow = () => new Promise<{ value: string; ttlMs: number }>((r) => (release = r));
    expect(await cache.getOrLoad("k", slow, { staleWhileRevalidate: true })).toBe("old");
    expect(await cache.getOrLoad("k", slow, { staleWhileRevalidate: true })).toBe("old");
    release({ value: "new", ttlMs: 1000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.get("k")).toBe("new");
  });

  it("waits for the load when nothing was remembered, or without staleWhileRevalidate", async () => {
    let now = 0;
    const cache = new TtlCache<string>(10, () => now);
    cache.remember("k", "old");
    cache.set("k", "old", 1000);
    now = 2000;
    expect(await cache.getOrLoad("k", async () => ({ value: "new", ttlMs: 1000 }))).toBe("new");
    expect(await cache.getOrLoad("other", async () => ({ value: "x", ttlMs: 1000 }), { staleWhileRevalidate: true })).toBe("x");
  });
});
