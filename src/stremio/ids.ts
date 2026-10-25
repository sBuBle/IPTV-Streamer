/** Stremio id scheme. Every id starts with "iltv:" so Stremio routes only our items to us. */
export const ID_PREFIX = "iltv:";

/** Provider ids, channel ids, program ids and episode ids may only use these characters. */
const PART = "[A-Za-z0-9_-]+";

export interface LiveItemId {
  kind: "live";
  provider: string;
  channelId: string;
}

/** A VOD program (series or movie), or one of its episodes when episodeId is set. */
export interface VodItemId {
  kind: "vod";
  provider: string;
  programId: string;
  episodeId?: string;
}

export type ItemId = LiveItemId | VodItemId;

export function liveItemId(provider: string, channelId: string): string {
  return `${ID_PREFIX}live:${provider}:${channelId}`;
}

export function vodProgramId(provider: string, programId: string): string {
  return `${ID_PREFIX}vod:${provider}:${programId}`;
}

export function vodEpisodeId(provider: string, programId: string, episodeId: string): string {
  return `${vodProgramId(provider, programId)}:${episodeId}`;
}

/** True when the string can be used as one part of an id. */
export function isIdPart(s: string): boolean {
  return new RegExp(`^${PART}$`).test(s);
}

const LIVE_RE = new RegExp(`^iltv:live:([a-z0-9-]+):(${PART})$`);
const VOD_RE = new RegExp(`^iltv:vod:([a-z0-9-]+):(${PART})(?::(${PART}))?$`);

export function parseItemId(id: string): ItemId | undefined {
  const live = id.match(LIVE_RE);
  if (live) return { kind: "live", provider: live[1]!, channelId: live[2]! };
  const vod = id.match(VOD_RE);
  if (vod) return { kind: "vod", provider: vod[1]!, programId: vod[2]!, ...(vod[3] ? { episodeId: vod[3] } : {}) };
  return undefined;
}
