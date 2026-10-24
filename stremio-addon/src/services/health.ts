import type { ItemHealth, StreamCheck } from "../domain/types.js";
import type { LatestChecks } from "../storage/types.js";

/**
 * Turns the latest checks of an item into a status.
 * Only a passing playback (decode) check makes an item "verified"; a passing probe is just "reachable".
 * A probe failure newer than the last good playback means the stream is probably down now.
 */
export function itemHealth(latest: LatestChecks | undefined, now: number, maxAgeMs: number): ItemHealth {
  const probe = latest?.probe;
  const playback = latest?.playback;
  const fresh = (c?: StreamCheck) => !!c && now - c.checkedAt <= maxAgeMs;
  const base = { lastProbe: probe, lastPlayback: playback };

  if (probe && !probe.ok && fresh(probe) && (!playback || probe.checkedAt > playback.checkedAt)) return { status: "failing", ...base };
  if (playback?.ok && fresh(playback)) return { status: "verified", ...base };
  if (playback && !playback.ok && fresh(playback)) return { status: "failing", ...base };
  if (probe?.ok && fresh(probe)) return { status: "reachable", ...base };
  return { status: "unverified", ...base };
}

export function describeAge(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(min, 1)} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function statusLine(h: ItemHealth, now: number): string {
  const where = (c?: StreamCheck) => (c?.location ? ` from ${c.location}` : "");
  switch (h.status) {
    case "verified":
      return `✅ Playback verified ${describeAge(now - h.lastPlayback!.checkedAt)}${where(h.lastPlayback)}`;
    case "failing": {
      const c = h.lastProbe && (!h.lastPlayback || h.lastProbe.checkedAt > h.lastPlayback.checkedAt) ? h.lastProbe : h.lastPlayback!;
      return `❌ Last check failed ${describeAge(now - c.checkedAt)}${where(c)}`;
    }
    case "reachable":
      return `⚠️ Stream reachable, playback not verified yet`;
    case "unverified":
      return `⚠️ Not verified yet`;
  }
}
