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
  const page = await getJson(`${req.apiUrl.replace(/\/+$/, "")}/interface/pages/${encodeURIComponent(pageId)}`, {
    headers: { platform: "web", "x-device-type": "web", "x-tenant-id": req.tenant, regioncode: region },
    timeoutMs: req.timeoutMs,
    fetch: req.fetch,
    signal: req.signal,
    retries: 1,
  });
  return extractChannels(page);
}
