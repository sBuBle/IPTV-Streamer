import type { Config } from "../../config.js";
import type { LiveChannel, ResolvedStream } from "../../domain/types.js";
import { extractManifestUrls } from "../../media/extract.js";
import { getText } from "../../util/http.js";
import type { ProviderAdapter, ProviderContext, ProviderIssue } from "../types.js";
import { KnessetVod } from "./vod.js";

const PROVIDER = "knesset";
const CHANNEL_ID = "knesset-99";

/**
 * Knesset Channel (channel 99). Either a direct manifest URL from config, or a player page that is read
 * at request time so a changed CDN path is picked up automatically. Page result wins; the direct URL is
 * kept as a backup.
 */
export class KnessetAdapter implements ProviderAdapter {
  readonly id = PROVIDER;
  readonly name = "Knesset Channel";

  readonly vod?: KnessetVod;

  constructor(private readonly cfg: Config["providers"]["knesset"]) {
    if (cfg.vodPages.length) this.vod = new KnessetVod({ showPages: cfg.vodPages, maxEpisodePages: cfg.vodMaxPages, sitemaps: cfg.vodSitemaps });
  }

  issues(): ProviderIssue[] {
    if (!this.cfg.liveUrl && !this.cfg.livePage && !this.vod) {
      return [{ severity: "error", message: "set KNESSET_LIVE_URL, KNESSET_LIVE_PAGE or KNESSET_VOD_PAGES; run `npm run discover` on the host to find them" }];
    }
    return [];
  }

  readonly live = {
    listChannels: async (): Promise<LiveChannel[]> => (!this.cfg.liveUrl && !this.cfg.livePage ? [] : [
      {
        id: CHANNEL_ID,
        provider: PROVIDER,
        name: "Knesset Channel",
        nameHe: "ערוץ הכנסת",
        aliases: ["ערוץ 99", "channel 99", "knesset"],
        description: "Live broadcast of Israel's parliament: plenary sessions, committees and current affairs.",
        genres: ["News", "Parliament"],
        language: "he",
        website: "https://main.knesset.gov.il",
        geo: "unknown",
      },
    ]),

    resolveStreams: async (channelId: string, ctx: ProviderContext): Promise<ResolvedStream[]> => {
      if (channelId !== CHANNEL_ID) return [];
      const urls: Array<{ url: string; source: string }> = [];
      if (this.cfg.livePage) {
        try {
          const { text, finalUrl } = await getText(this.cfg.livePage, {
            timeoutMs: ctx.config.requestTimeoutMs,
            fetch: ctx.fetch,
            signal: ctx.signal,
          });
          for (const url of extractManifestUrls(text, finalUrl).filter((u) => /\.m3u8(\?|$)/.test(u))) {
            urls.push({ url, source: "knesset-live-page" });
          }
          if (urls.length === 0) ctx.logger.warn("no manifest found on Knesset live page");
        } catch (err) {
          if (!this.cfg.liveUrl) throw err;
          ctx.logger.warn("Knesset live page failed, using configured URL", { error: err });
        }
      }
      if (this.cfg.liveUrl && !urls.some((u) => u.url === this.cfg.liveUrl)) urls.push({ url: this.cfg.liveUrl, source: "config" });
      return urls.map((u, i) => ({
        url: u.url,
        format: "hls" as const,
        label: i === 0 ? "Auto" : "Backup",
        source: u.source,
        geo: "unknown" as const,
      }));
    },
  };
}
