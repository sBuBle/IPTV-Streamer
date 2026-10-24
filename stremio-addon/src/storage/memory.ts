import type { CheckKind, StreamCheck } from "../domain/types.js";
import type { LatestChecks, Store } from "./types.js";

/** Non-persistent store for tests and for Workers deployments without a D1 binding. */
export class MemoryStore implements Store {
  private checks: StreamCheck[] = [];

  async init(): Promise<void> {}

  async recordCheck(check: StreamCheck): Promise<void> {
    this.checks.push(structuredClone(check));
  }

  async latestChecks(): Promise<Map<string, LatestChecks>> {
    const out = new Map<string, LatestChecks>();
    for (const c of this.checks) {
      const entry = out.get(c.itemId) ?? {};
      const prev = entry[c.kind];
      if (!prev || prev.checkedAt <= c.checkedAt) entry[c.kind] = c;
      out.set(c.itemId, entry);
    }
    return out;
  }

  async history(itemId: string, kind: CheckKind, limit: number): Promise<StreamCheck[]> {
    return this.checks
      .filter((c) => c.itemId === itemId && c.kind === kind)
      .sort((a, b) => b.checkedAt - a.checkedAt)
      .slice(0, limit);
  }

  async prune(olderThan: number): Promise<number> {
    const latest = new Set([...(await this.latestChecks()).values()].flatMap((l) => [l.probe, l.playback]));
    const before = this.checks.length;
    this.checks = this.checks.filter((c) => c.checkedAt >= olderThan || latest.has(c));
    return before - this.checks.length;
  }
}
