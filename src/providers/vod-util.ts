/** Helpers shared by VOD adapters for turning broadcaster data into seasons and episodes. */

/** "01:02:03" or "02:03" -> seconds. */
export function parseClock(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const parts = s.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const sec = parts.reduce((acc, n) => acc * 60 + n, 0);
  return sec > 0 ? sec : undefined;
}

export function isoDate(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  return new Date(ms).toISOString();
}

/** "24.10.26", "24.10.2026" or "24/10/2026" (Israeli day-first order) -> ISO date at midnight UTC. */
export function parseDayFirstDate(s: string | undefined): string | undefined {
  const m = s?.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

/** Episode number written in a title: "פרק 12", "Episode 12", "Ep. 12". */
export function episodeNumberFromTitle(title: string): number | undefined {
  const m = title.match(/(?:פרק|episode|ep\.?)\s*(\d{1,4})\b/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Gives every episode of a season a unique number. Numbers written by the broadcaster are kept when they are
 * unique; everything else is numbered after them in the given order, so irregular numbering never collides.
 */
export function assignEpisodeNumbers<T>(items: T[], declared: (item: T) => number | undefined): Array<T & { episode: number }> {
  const used = new Set<number>();
  const fixed = items.map((item) => {
    const n = declared(item);
    if (n !== undefined && !used.has(n)) {
      used.add(n);
      return n;
    }
    return undefined;
  });
  let next = 1;
  return items.map((item, i) => {
    let n = fixed[i];
    if (n === undefined) {
      while (used.has(next)) next++;
      n = next;
      used.add(n);
    }
    return { ...item, episode: n };
  });
}
