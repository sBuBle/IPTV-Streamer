/** Stremio id scheme. Every id starts with "iltv:" so Stremio routes only our items to us. */
export const ID_PREFIX = "iltv:";

export interface LiveItemId {
  kind: "live";
  provider: string;
  channelId: string;
}

export function liveItemId(provider: string, channelId: string): string {
  return `${ID_PREFIX}live:${provider}:${channelId}`;
}

export function parseItemId(id: string): LiveItemId | undefined {
  const m = id.match(/^iltv:live:([a-z0-9-]+):([a-z0-9-]+)$/);
  return m ? { kind: "live", provider: m[1]!, channelId: m[2]! } : undefined;
}
