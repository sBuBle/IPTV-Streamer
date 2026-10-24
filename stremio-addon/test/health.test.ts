import { describe, expect, it } from "vitest";
import type { StreamCheck } from "../src/domain/types.js";
import { itemHealth, statusLine } from "../src/services/health.js";

const H = 3600_000;
const now = 100 * H;
const c = (kind: StreamCheck["kind"], ok: boolean, hoursAgo: number, location?: string): StreamCheck => ({
  itemId: "x",
  provider: "p",
  kind,
  ok,
  checkedAt: now - hoursAgo * H,
  location,
  detail: {},
});

describe("item health", () => {
  const maxAge = 72 * H;
  it("is unverified without checks", () => expect(itemHealth(undefined, now, maxAge).status).toBe("unverified"));
  it("treats a passing probe as reachable, never verified", () => expect(itemHealth({ probe: c("probe", true, 1) }, now, maxAge).status).toBe("reachable"));
  it("verifies only on a fresh passing playback check", () => {
    expect(itemHealth({ playback: c("playback", true, 2) }, now, maxAge).status).toBe("verified");
    expect(itemHealth({ playback: c("playback", true, 100) }, now, maxAge).status).toBe("unverified");
  });
  it("marks failing when a newer probe fails after a good playback", () => {
    expect(itemHealth({ playback: c("playback", true, 5), probe: c("probe", false, 1) }, now, maxAge).status).toBe("failing");
    expect(itemHealth({ playback: c("playback", true, 1), probe: c("probe", false, 5) }, now, maxAge).status).toBe("verified");
  });
  it("describes status for viewers", () => {
    expect(statusLine(itemHealth({ playback: c("playback", true, 2, "IL") }, now, maxAge), now)).toBe("✅ Playback verified 2 h ago from IL");
    expect(statusLine(itemHealth({ probe: c("probe", true, 1) }, now, maxAge), now)).toMatch(/not verified/);
  });
});
