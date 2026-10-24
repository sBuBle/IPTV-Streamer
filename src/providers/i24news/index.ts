import type { Config } from "../../config.js";
import type { LiveChannel, ResolvedStream } from "../../domain/types.js";
import { errorMessage } from "../registry.js";
import type { ProviderAdapter, ProviderContext, ProviderIssue } from "../types.js";
import { fetchRegionChannels, type InsightChannel } from "./insight.js";

const PROVIDER = "i24news";

interface FeedInfo {
  name: string;
  nameHe?: string;
  language: string;
  description: string;
}

const FEEDS: Record<string, FeedInfo> = {
  en: { name: "i24NEWS English", language: "en", description: "i24NEWS international news channel, English-language feed." },
  fr: { name: "i24NEWS Français", language: "fr", description: "i24NEWS international news channel, French-language feed." },
  ar: { name: "i24NEWS عربي", language: "ar", description: "i24NEWS international news channel, Arabic-language feed." },
  he: { name: "i24NEWS עברית", nameHe: "i24NEWS עברית", language: "he", description: "i24NEWS news channel, Hebrew-language feed." },
};

const LANGUAGE_WORDS: Array<[RegExp, string]> = [
  [/english/i, "en"],
  [/fran[cç]ais|french/i, "fr"],
  [/arabic|عربي/i, "ar"],
  [/hebrew|עברית/i, "he"],
];

/**
 * Last known channel list from the Insight API (read 24 Oct 2026), used only when the API is down.
 * The stream URLs carry no tokens, so they stay valid until i24NEWS changes its encoders.
 */
export const FALLBACK_CHANNELS: InsightChannel[] = [
  { id: "687cb5e702849489dbfed06f", type: "channel", title: "I24NEWS English", videoUrl: "https://i24newsenglish-cdn.encoders.immergo.tv/master.m3u8", image: "https://i24israel.vod.immergo.tv/i24israel/uploaded/cfa5d3e0-08e3-4d34-826d-3b058755a5d8.png", epgObject: { input: "https://epg.i24news.tv/xmlTV_EN.xml" } },
  { id: "687cb60702849489dbfed071", type: "channel", title: "I24NEWS Francais", videoUrl: "https://i24newsfrench-cdn.encoders.immergo.tv/master.m3u8", image: "https://i24israel.vod.immergo.tv/i24israel/uploaded/c294f039-d2a5-4be8-a1f4-2318d1eec6ef.png", epgObject: { input: "https://epg.i24news.tv/xmlTV_FR.xml" } },
  { id: "687cb6a0e0ed1401d770b0e1", type: "channel", title: "I24NEWS Arabic", videoUrl: "https://i24newsarabic-cdn.encoders.immergo.tv/master.m3u8", image: "https://i24israel.vod.immergo.tv/i24israel/uploaded/0caba14a-6f49-4db6-abf9-854b60c3ec91.png", epgObject: { input: "https://epg.i24news.tv/xmlTV_AR.xml" } },
  { id: "69b17e029abd89c807678067", type: "channel", title: "i24NEWS Hebrew", videoUrl: "https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8", image: "https://i24israel.vod.immergo.tv/i24israel/uploaded/e7deec2a-ce5a-4c3a-b73c-84464b2904f1.png", epgObject: { input: "https://epg.i24news.tv/xmlTV_HE.xml" } },
];

export function feedLanguage(c: Pick<InsightChannel, "title" | "videoUrl">): string | undefined {
  const text = `${c.title} ${new URL(c.videoUrl).hostname}`;
  return LANGUAGE_WORDS.find(([re]) => re.test(text))?.[1];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "channel";
}

/**
 * i24NEWS live feeds (English, French, Arabic, Hebrew) from the Insight API behind video.i24news.tv.
 * New channels that appear in the API are picked up automatically.
 */
export class I24NewsAdapter implements ProviderAdapter {
  readonly id = PROVIDER;
  readonly name = "i24NEWS";
  private streams = new Map<string, InsightChannel>();

  constructor(private readonly cfg: Config["providers"]["i24news"]) {}

  issues(): ProviderIssue[] {
    return Object.keys(this.cfg.pages).length ? [] : [{ severity: "error", message: "I24_PAGES is empty" }];
  }

  private async loadChannels(ctx: ProviderContext): Promise<InsightChannel[]> {
    const req = { apiUrl: this.cfg.apiUrl, tenant: this.cfg.tenant, fetch: ctx.fetch, timeoutMs: ctx.config.requestTimeoutMs, signal: ctx.signal };
    const results = await Promise.allSettled(Object.entries(this.cfg.pages).map(([region, pageId]) => fetchRegionChannels(region, pageId, req)));
    const found = new Map<string, InsightChannel>();
    for (const r of results) {
      if (r.status === "fulfilled") r.value.forEach((c) => found.has(c.id) || found.set(c.id, c));
      else ctx.logger.warn("i24NEWS region page failed", { error: errorMessage(r.reason) });
    }
    if (found.size === 0) {
      ctx.logger.warn("i24NEWS API returned no channels, using the last known list");
      return FALLBACK_CHANNELS;
    }
    return [...found.values()];
  }

  readonly live = {
    listChannels: async (ctx: ProviderContext): Promise<LiveChannel[]> => {
      const channels = await this.loadChannels(ctx);
      const out: LiveChannel[] = [];
      const streams = new Map<string, InsightChannel>();
      for (const c of channels) {
        const lang = feedLanguage(c);
        const id = `i24news-${lang ?? slug(c.title)}`;
        if (streams.has(id)) continue;
        streams.set(id, c);
        const feed = lang ? FEEDS[lang] : undefined;
        out.push({
          id,
          provider: PROVIDER,
          name: feed?.name ?? c.title,
          nameHe: feed?.nameHe,
          aliases: ["i24", "i24 news", "i24news"],
          description: feed?.description ?? c.description ?? "i24NEWS live channel.",
          genres: ["News"],
          language: feed?.language ?? "en",
          logo: c.image ?? undefined,
          website: "https://video.i24news.tv",
          epgUrl: c.epgObject?.input ?? undefined,
          geo: "unknown",
        });
      }
      this.streams = streams;
      return out;
    },

    resolveStreams: async (channelId: string, ctx: ProviderContext): Promise<ResolvedStream[]> => {
      if (!this.streams.has(channelId)) await this.live.listChannels(ctx);
      const c = this.streams.get(channelId);
      if (!c) return [];
      const fallback = FALLBACK_CHANNELS.find((f) => feedLanguage(f) === feedLanguage(c));
      const urls = [c.videoUrl, ...(fallback && fallback.videoUrl !== c.videoUrl ? [fallback.videoUrl] : [])];
      return urls.map((url, i) => ({
        url,
        format: "hls" as const,
        label: i === 0 ? "Auto" : "Backup",
        source: i === 0 ? "insight-api" : "last-known",
        geo: "unknown" as const,
      }));
    },
  };
}
