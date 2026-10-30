import { z } from "zod";
import { getJson, type FetchFn } from "../../util/http.js";

/**
 * Client for Univtec's Insight API, which powers video.i24news.tv since 2026.
 * The site's home page for each region lists the live channels with their HLS URL, logo and EPG feed.
 */

const channelItem = z.object({
  id: z.string(),
  type: z.literal("channel"),
  title: z.string().min(1),
  videoUrl: z.url(),
  image: z.string().nullish(),
  description: z.string().nullish(),
  epgObject: z.object({ input: z.string().nullish() }).passthrough().nullish(),
});

export type InsightChannel = z.infer<typeof channelItem>;

export interface InsightRequest {
  apiUrl: string;
  tenant: string;
  fetch: FetchFn;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Walks a page response and returns every live channel item in it, wherever the section puts it. */
export function extractChannels(page: unknown): InsightChannel[] {
  const out = new Map<string, InsightChannel>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const parsed = channelItem.safeParse(node);
      if (parsed.success && !out.has(parsed.data.id)) out.set(parsed.data.id, parsed.data);
      Object.values(node).forEach(walk);
    }
  };
  walk(page);
  return [...out.values()];
}

export async function fetchRegionChannels(region: string, pageId: string, req: InsightRequest): Promise<InsightChannel[]> {
  return extractChannels(await fetchRegionPage(region, pageId, req));
}

/** A show (program) listed on a region page. Its episodes come from the series endpoint. */
const showItem = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  entity: z.literal("series"),
  title: z.string().min(1),
  description: z.string().nullish(),
  image: z.string().nullish(),
  poster: z.string().nullish(),
  amountOfEpisodes: z.number().nullish(),
  dateUpdate: z.number().nullish(),
});

export type InsightShow = z.infer<typeof showItem>;

/** Walks a page response and returns every show (series/program) item in it. */
export function extractShows(page: unknown): InsightShow[] {
  const out = new Map<string, InsightShow>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const parsed = showItem.safeParse(node);
      if (parsed.success && !out.has(parsed.data.id)) out.set(parsed.data.id, parsed.data);
      Object.values(node).forEach(walk);
    }
  };
  walk(page);
  return [...out.values()];
}

const episodeItem = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().min(1),
  videoUrl: z.string().nullish(),
  image: z.string().nullish(),
  poster: z.string().nullish(),
  description: z.string().nullish(),
  date: z.number().nullish(),
  duration: z.string().nullish(),
  commerceType: z.string().nullish(),
  paidType: z.string().nullish(),
});

export type InsightEpisode = z.infer<typeof episodeItem>;

const seriesResponse = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  longDescription: z.string().nullish(),
  image: z.string().nullish(),
  poster: z.string().nullish(),
  seasons: z
    .array(
      z.object({
        title: z.string().nullish(),
        episodes: z.array(z.unknown()).nullish(),
      }),
    )
    .default([]),
});

export interface InsightSeries {
  id: string;
  title: string;
  description?: string;
  image?: string;
  seasons: Array<{ title?: string; episodes: InsightEpisode[] }>;
}

function headers(req: InsightRequest, region: string) {
  return { platform: "web", "x-device-type": "web", "x-tenant-id": req.tenant, regioncode: region };
}

function api(req: InsightRequest, path: string): string {
  return `${req.apiUrl.replace(/\/+$/, "")}/interface/${path}`;
}

export async function fetchRegionPage(region: string, pageId: string, req: InsightRequest): Promise<unknown> {
  return getJson(api(req, `pages/${encodeURIComponent(pageId)}`), { headers: headers(req, region), timeoutMs: req.timeoutMs, fetch: req.fetch, signal: req.signal, retries: 1 });
}

/** A show with all its seasons and episodes. Episodes that fail validation are dropped, not fatal. */
export async function fetchSeries(id: string, region: string, req: InsightRequest): Promise<InsightSeries | undefined> {
  const raw = await getJson(api(req, `pages/series/${encodeURIComponent(id)}`), { headers: headers(req, region), timeoutMs: req.timeoutMs, fetch: req.fetch, signal: req.signal, retries: 1 });
  const parsed = seriesResponse.safeParse(raw);
  if (!parsed.success) return undefined;
  const s = parsed.data;
  return {
    id: s.id,
    title: s.title,
    description: s.longDescription ?? s.description ?? undefined,
    image: s.image ?? s.poster ?? undefined,
    seasons: s.seasons.map((season) => ({
      title: season.title ?? undefined,
      episodes: (season.episodes ?? []).flatMap((e) => {
        const ep = episodeItem.safeParse(e);
        return ep.success ? [ep.data] : [];
      }),
    })),
  };
}

/** One VOD item, fetched fresh so the playback URL is current. */
export async function fetchVod(id: string, region: string, req: InsightRequest): Promise<InsightEpisode | undefined> {
  const raw = await getJson(api(req, `pages/vod/${encodeURIComponent(id)}`), { headers: headers(req, region), timeoutMs: req.timeoutMs, fetch: req.fetch, signal: req.signal, retries: 1 });
  const first = Array.isArray(raw) ? raw[0] : raw;
  const parsed = episodeItem.safeParse(first);
  return parsed.success ? parsed.data : undefined;
}
