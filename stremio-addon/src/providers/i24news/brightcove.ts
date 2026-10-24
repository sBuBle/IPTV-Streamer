import { z } from "zod";
import { getJson, getText, type FetchFn } from "../../util/http.js";

/**
 * Brightcove Playback API client.
 * Docs: https://apis.support.brightcove.com/playback/references/playback-api-video-fields-reference.html
 * Each call returns fresh, short-lived source URLs (Akamai tokens), so results are only cached briefly.
 */

const sourceSchema = z.object({
  src: z.string().optional(),
  type: z.string().optional(),
  key_systems: z.record(z.string(), z.unknown()).optional(),
  height: z.number().optional(),
});

const playbackSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  sources: z.array(sourceSchema),
});

export type BrightcoveSource = z.infer<typeof sourceSchema>;
export type BrightcovePlayback = z.infer<typeof playbackSchema>;

export interface BrightcoveRequest {
  fetch: FetchFn;
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function fetchPlayback(
  account: string,
  videoId: string,
  policyKey: string,
  req: BrightcoveRequest,
): Promise<BrightcovePlayback> {
  const url = `https://edge.api.brightcove.com/playback/v1/accounts/${encodeURIComponent(account)}/videos/${encodeURIComponent(videoId)}`;
  const json = await getJson(url, {
    headers: { Accept: `application/json;pk=${policyKey}` },
    timeoutMs: req.timeoutMs,
    fetch: req.fetch,
    signal: req.signal,
    retries: 1,
  });
  return playbackSchema.parse(json);
}

/** Brightcove embeds the policy key in each player's script as policyKey:"BCpk...". */
export function extractPolicyKey(playerScript: string): string | undefined {
  return playerScript.match(/policyKey\s*:\s*["'](BCpk[A-Za-z0-9_\-.]+)["']/)?.[1];
}

export async function fetchPolicyKey(account: string, playerId: string, req: BrightcoveRequest): Promise<string> {
  const url = `https://players.brightcove.net/${encodeURIComponent(account)}/${encodeURIComponent(playerId)}_default/index.min.js`;
  const { text } = await getText(url, { timeoutMs: req.timeoutMs, fetch: req.fetch, signal: req.signal, retries: 1 });
  const key = extractPolicyKey(text);
  if (!key) throw new Error(`no policyKey found in Brightcove player ${playerId}`);
  return key;
}

export function isHlsSource(s: BrightcoveSource): boolean {
  return !!s.src && (s.type === "application/x-mpegURL" || s.type === "application/vnd.apple.mpegurl" || /\.m3u8(\?|$)/.test(s.src));
}

/** Reads the expiry of an Akamai token (hdnea=exp=...~ or hdnts=exp=...) from a URL. Epoch ms. */
export function tokenExpiry(url: string): number | undefined {
  const m = decodeURIComponent(url).match(/(?:hdnea|hdnts|__token__)=(?:[^&]*?[~&])?exp=(\d{9,11})/) ?? url.match(/[?&~]exp=(\d{9,11})/);
  return m ? Number(m[1]) * 1000 : undefined;
}
