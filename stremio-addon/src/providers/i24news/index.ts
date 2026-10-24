import type { Config } from "../../config.js";
import type { LiveChannel, ResolvedStream } from "../../domain/types.js";
import { TtlCache } from "../../util/cache.js";
import type { ProviderAdapter, ProviderContext, ProviderIssue } from "../types.js";
import { fetchPlayback, fetchPolicyKey, isHlsSource, tokenExpiry } from "./brightcove.js";

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

/**
 * i24NEWS live feeds through Brightcove's Playback API.
 * Live video ids and the player id (or policy key) come from config because they have to be read from
 * i24news.tv on a real host first (`npm run discover`); nothing here is guessed.
 */
export class I24NewsAdapter implements ProviderAdapter {
  readonly id = PROVIDER;
  readonly name = "i24NEWS";
  private readonly policyKeys = new TtlCache<string>(4);

  constructor(private readonly cfg: Config["providers"]["i24news"]) {}

  issues(): ProviderIssue[] {
    const out: ProviderIssue[] = [];
    const ids = Object.keys(this.cfg.liveVideoIds);
    if (ids.length === 0) out.push({ severity: "error", message: "I24_LIVE_VIDEO_IDS is not set; run `npm run discover` on the host and set it" });
    for (const lang of ids) if (!FEEDS[lang]) out.push({ severity: "warning", message: `unknown i24NEWS feed language "${lang}" is ignored` });
    if (!this.cfg.policyKey && !this.cfg.playerId) out.push({ severity: "error", message: "set I24_BRIGHTCOVE_POLICY_KEY or I24_BRIGHTCOVE_PLAYER_ID" });
    return out;
  }

  readonly live = {
    listChannels: async (): Promise<LiveChannel[]> =>
      Object.keys(this.cfg.liveVideoIds)
        .filter((lang) => FEEDS[lang])
        .map((lang) => {
          const f = FEEDS[lang]!;
          return {
            id: `i24news-${lang}`,
            provider: PROVIDER,
            name: f.name,
            nameHe: f.nameHe,
            aliases: ["i24", "i24 news", "איי 24"],
            description: f.description,
            genres: ["News"],
            language: f.language,
            website: "https://www.i24news.tv",
            geo: "unknown",
          };
        }),

    resolveStreams: async (channelId: string, ctx: ProviderContext): Promise<ResolvedStream[]> => {
      const lang = channelId.replace(/^i24news-/, "");
      const videoId = this.cfg.liveVideoIds[lang];
      if (!videoId) return [];
      const req = { fetch: ctx.fetch, timeoutMs: ctx.config.requestTimeoutMs, signal: ctx.signal };
      const policyKey =
        this.cfg.policyKey ??
        (await this.policyKeys.getOrLoad(this.cfg.playerId!, async () => ({
          value: await fetchPolicyKey(this.cfg.account, this.cfg.playerId!, req),
          ttlMs: 6 * 3600_000,
        })));
      const playback = await fetchPlayback(this.cfg.account, videoId, policyKey, req);
      const drmCount = playback.sources.filter((s) => s.key_systems && Object.keys(s.key_systems).length).length;
      if (drmCount) ctx.logger.warn("skipping DRM sources", { channelId, drmCount });

      const seen = new Set<string>();
      return playback.sources
        .filter((s) => isHlsSource(s) && !(s.key_systems && Object.keys(s.key_systems).length))
        .filter((s) => s.src!.startsWith("https://"))
        .filter((s) => (seen.has(s.src!) ? false : (seen.add(s.src!), true)))
        .map((s, i) => ({
          url: s.src!,
          format: "hls" as const,
          label: i === 0 ? "Auto" : `Alt ${i}`,
          expiresAt: tokenExpiry(s.src!),
          source: "brightcove-playback-api",
          geo: "unknown" as const,
        }));
    },
  };
}
