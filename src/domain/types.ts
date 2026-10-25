/**
 * Where a broadcaster lets a stream play, as far as we know.
 * "israel-only" items are labeled for viewers and never relayed through this server.
 */
export type GeoAvailability = "worldwide" | "israel-only" | "unknown";

/** "external" is not a stream: a link to the broadcaster's own page, for content we cannot play. */
export type StreamFormat = "hls" | "dash" | "mp4" | "external";

export interface LiveChannel {
  /** Stable id, unique within the provider, e.g. "i24news-en". */
  id: string;
  provider: string;
  name: string;
  nameHe?: string;
  aliases?: string[];
  description: string;
  /** Stremio genres, used as categories (News, Parliament, ...). */
  genres: string[];
  /** ISO 639-1 language of the broadcast. */
  language: string;
  logo?: string;
  website?: string;
  /** XMLTV guide for the channel, when the broadcaster publishes one. */
  epgUrl?: string;
  geo: GeoAvailability;
}

export interface ResolvedStream {
  url: string;
  format: StreamFormat;
  /** Short label such as "Auto", "720p" or "Backup". */
  label?: string;
  /** Headers the player must send. Stremio applies them via behaviorHints.proxyHeaders. */
  headers?: Record<string, string>;
  /** Epoch ms after which the URL (signed token) stops working. */
  expiresAt?: number;
  /** How the URL was obtained, for diagnostics. */
  source: string;
  geo: GeoAvailability;
}

export type CheckKind = "probe" | "playback";

/**
 * One check of one item's stream.
 * "probe": the manifest, a variant playlist and a media segment downloaded and looked like media.
 * "playback": real video (and audio) frames were decoded. Only this counts as verified.
 */
export interface StreamCheck {
  itemId: string;
  provider: string;
  kind: CheckKind;
  ok: boolean;
  checkedAt: number;
  /** Where the check ran from, e.g. "IL". Geo-blocked streams pass only from some places. */
  location?: string;
  streamHost?: string;
  detail: Record<string, unknown>;
  error?: string;
}

export type ItemStatus = "verified" | "failing" | "reachable" | "unverified";

export interface ItemHealth {
  status: ItemStatus;
  lastProbe?: StreamCheck;
  lastPlayback?: StreamCheck;
}
