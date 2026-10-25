import { z } from "zod";
import type { Config } from "../../config.js";
import type { GeoAvailability, ResolvedStream } from "../../domain/types.js";
import { getText } from "../../util/http.js";
import { errorMessage } from "../registry.js";
import type { ProviderAdapter, ProviderContext, ProviderIssue, VodEpisode, VodProgram, VodProgramDetail } from "../types.js";
import { assignEpisodeNumbers, parseDayFirstDate } from "../vod-util.js";

const PROVIDER = "mako";
const SITE = "https://www.mako.co.il";
const MAX_SEASON_PAGES = 20;

const indexSchema = z.object({
  items: z.array(z.object({ title: z.string().min(1), pageUrl: z.string().startsWith("/"), pic: z.string().nullish() })),
});

const vodItem = z.object({
  title: z.string().min(1),
  pageUrl: z.string(),
  pics: z.array(z.object({ picUrl: z.string() })).nullish(),
  extraInfo: z.string().nullish(),
  aINT: z.boolean().nullish(),
  aIL: z.boolean().nullish(),
});

const programPage = z.object({
  pageUrl: z.string().nullish(),
  channelName: z.string().nullish(),
  seo: z
    .object({
      schema: z.object({ name: z.string().nullish(), description: z.string().nullish(), image: z.string().nullish(), genre: z.array(z.string()).nullish() }).passthrough().nullish(),
    })
    .passthrough()
    .nullish(),
  hero: z.object({ description: z.string().nullish(), logo: z.string().nullish(), pics: z.array(z.object({ picUrl: z.string() })).nullish() }).passthrough().nullish(),
  seasons: z.array(z.object({ seasonTitle: z.string(), pageUrl: z.string(), current: z.boolean().nullish() })).nullish(),
  menu: z.array(z.object({ id: z.string().nullish(), vods: z.array(z.unknown()).nullish() })).nullish(),
});

type ProgramPage = z.infer<typeof programPage>;

function slugOf(pageUrl: string): string | undefined {
  const slug = pageUrl.split("?")[0]!.replace(/\/+$/, "").split("/").pop();
  return slug && /^[A-Za-z0-9_-]+$/.test(slug) ? slug : undefined;
}

/** Full episodes of a season page ("allEpisodes" menu), not specials or short clips. */
function seasonVods(page: ProgramPage): Array<z.infer<typeof vodItem>> {
  const menu = page.menu?.find((m) => m.id === "allEpisodes") ?? page.menu?.[0];
  return (menu?.vods ?? []).flatMap((v) => {
    const parsed = vodItem.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

/** "עונה 5@פרק 3@24.10.26" -> episode 3, released 24 Oct 2026. */
export function parseExtraInfo(extra: string | null | undefined): { episode?: number; released?: string } {
  const parts = (extra ?? "").split("@");
  const ep = parts.map((p) => p.match(/פרק\s*(\d+)/)?.[1]).find(Boolean);
  return { episode: ep ? Number(ep) : undefined, released: parts.map((p) => parseDayFirstDate(p)).find(Boolean) };
}

/**
 * Mako (Keshet 12) VOD, catalog only. Mako's catalog JSON is readable from anywhere, but playback needs a
 * per-viewer entitlement ticket that Mako issues only to Israeli viewers, behind an encrypted playlist.
 * This adapter does not work around that: each episode links out to its page on mako.co.il instead of
 * offering a stream. It is off unless MAKO_VOD=catalog.
 */
export class MakoAdapter implements ProviderAdapter {
  readonly id = PROVIDER;
  readonly name = "Mako (Keshet 12)";
  private pages = new Map<string, string>();
  /** "<programId>:<episodeId>" -> episode page path, filled when a program is read. */
  private episodePages = new Map<string, string>();

  constructor(private readonly cfg: Config["providers"]["mako"]) {}

  issues(): ProviderIssue[] {
    return this.cfg.mode === "off" ? [{ severity: "error", message: "Mako VOD is off; set MAKO_VOD=catalog to list its catalog with links to mako.co.il" }] : [];
  }

  private async json(path: string, ctx: ProviderContext): Promise<unknown> {
    const url = new URL(path, SITE);
    url.searchParams.set("platform", "responsive");
    const res = await getText(url.toString(), { timeoutMs: ctx.config.requestTimeoutMs, fetch: ctx.fetch, signal: ctx.signal, retries: 1 });
    // Mako's bot protection (Radware) redirects automated clients to a block page. That is an access control,
    // so it is reported, not worked around.
    if (/perfdrive\.com/.test(new URL(res.finalUrl).hostname) || res.text.trimStart().startsWith("<")) {
      throw new Error("blocked by Mako's bot protection (Radware block page instead of catalog JSON)");
    }
    return JSON.parse(res.text);
  }

  readonly vod = {
    listPrograms: async (ctx: ProviderContext): Promise<VodProgram[]> => {
      const index = indexSchema.parse(await this.json(this.cfg.indexUrl, ctx));
      const out = new Map<string, VodProgram>();
      const pages = new Map<string, string>();
      for (const item of index.items) {
        const id = slugOf(item.pageUrl);
        if (!id || out.has(id)) continue;
        pages.set(id, item.pageUrl);
        out.set(id, {
          id,
          provider: PROVIDER,
          kind: "series",
          title: item.title,
          poster: item.pic ?? undefined,
          posterShape: "landscape",
          genres: item.pageUrl.includes("news") ? ["News"] : ["Entertainment"],
          language: "he",
          website: `${SITE}${item.pageUrl}`,
          geo: "israel-only",
        });
      }
      this.pages = pages;
      return [...out.values()];
    },

    getProgram: async (programId: string, ctx: ProviderContext): Promise<VodProgramDetail | undefined> => {
      if (!this.pages.has(programId)) await this.vod.listPrograms(ctx).catch(() => []);
      const path = this.pages.get(programId);
      if (!path) return undefined;
      const main = programPage.parse(await this.json(path, ctx));
      const seasons = main.seasons?.length ? main.seasons : [{ seasonTitle: main.channelName ?? "1", pageUrl: main.pageUrl ?? path, current: true }];
      const numbered = seasons.map((s, i) => ({ ...s, number: Number(s.seasonTitle.match(/עונה\s*(\d+)/)?.[1] ?? NaN) || i + 1 }));
      const wanted = numbered.slice(-MAX_SEASON_PAGES);
      const pages = await Promise.allSettled(
        wanted.map((s) => (main.pageUrl && s.pageUrl === main.pageUrl ? Promise.resolve(main) : this.json(s.pageUrl, ctx).then((p) => programPage.parse(p)))),
      );
      const episodes: VodEpisode[] = [];
      let geo: GeoAvailability = "unknown";
      pages.forEach((r, i) => {
        const season = wanted[i]!;
        if (r.status === "rejected") {
          ctx.logger.warn("Mako season page failed", { programId, season: season.seasonTitle, error: errorMessage(r.reason) });
          return;
        }
        const vods = seasonVods(r.value).reverse(); // newest first on the site
        if (vods.some((v) => v.aINT === false)) geo = "israel-only";
        for (const v of assignEpisodeNumbers(vods, (x) => parseExtraInfo(x.extraInfo).episode)) {
          const vodId = v.pageUrl.match(/VOD-([A-Za-z0-9]+)\.htm/)?.[1];
          if (!vodId) continue;
          this.episodePages.set(`${programId}:${season.number}-${vodId}`, v.pageUrl);
          episodes.push({
            id: `${season.number}-${vodId}`,
            season: season.number,
            episode: v.episode,
            title: v.title,
            released: parseExtraInfo(v.extraInfo).released,
            thumbnail: v.pics?.[0]?.picUrl,
          });
        }
      });
      const schema = main.seo?.schema;
      return {
        id: programId,
        provider: PROVIDER,
        kind: "series",
        title: schema?.name ?? programId,
        poster: schema?.image ?? undefined,
        posterShape: "landscape",
        background: main.hero?.pics?.[0]?.picUrl ?? schema?.image ?? undefined,
        logo: main.hero?.logo ?? undefined,
        description: schema?.description ?? main.hero?.description ?? undefined,
        genres: path.includes("news") ? ["News"] : ["Entertainment"],
        language: "he",
        website: `${SITE}${path}`,
        geo: geo === "unknown" ? "israel-only" : geo,
        episodes: episodes.sort((a, b) => a.season - b.season || a.episode - b.episode),
        seasonNames: Object.fromEntries(wanted.map((s) => [s.number, s.seasonTitle])),
      };
    },

    /** No playable stream: a link to the episode on mako.co.il, labeled as such. */
    resolveEpisodeStreams: async (programId: string, episodeId: string, ctx: ProviderContext): Promise<ResolvedStream[]> => {
      const key = `${programId}:${episodeId}`;
      if (!this.episodePages.has(key)) await this.vod.getProgram(programId, ctx);
      const page = this.episodePages.get(key);
      if (!page) return [];
      return [{ url: new URL(page, SITE).toString(), format: "external", label: "mako.co.il", source: "mako-catalog", geo: "israel-only" }];
    },
  };
}
