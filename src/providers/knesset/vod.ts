import type { ResolvedStream } from "../../domain/types.js";
import { extractManifestUrls } from "../../media/extract.js";
import { absoluteUrl, anchors, attr, firstImage, metaContent, textOf } from "../../util/html.js";
import { getText } from "../../util/http.js";
import { mapPool } from "../../util/pool.js";
import { sitemapLocs } from "../../util/sitemap.js";
import { errorMessage } from "../registry.js";
import type { ProviderContext, VodCapability, VodEpisode, VodProgram, VodProgramDetail } from "../types.js";
import { assignEpisodeNumbers, episodeNumberFromTitle, parseDayFirstDate } from "../vod-util.js";

const PROVIDER = "knesset";
const SITE = "https://www.knesset.tv";
/** Show pages fetched at once when paging through a long show. knesset.tv answers 429 to more. */
const PAGE_BATCH = 3;

export interface KnessetVodConfig {
  /** Pages that list the TV shows as cards (knesset.tv/tv-shows/, knesset.tv/vod/). */
  showPages: string[];
  /** Show pages hold 12 episodes each; at most this many pages are read per show. */
  maxEpisodePages: number;
  /** Sitemaps listing show pages, for older shows the listing pages no longer link to. */
  sitemaps?: string[];
}

interface ShowEpisodes {
  episodes: ListedEpisode[];
  complete: boolean;
  readAt: number;
}

/** Older pages of a show are read again after this long (new episodes always appear on the first page). */
const SHOW_EPISODES_TTL_MS = 24 * 3600_000;
/** Time kept free before the request's deadline to build the reply. */
const DEADLINE_MARGIN_MS = 2_500;

/** Shows found through the sitemap are looked up again after this long. */
const SITEMAP_REFRESH_MS = 24 * 3600_000;

const SHOW_HREF = /^(?:https:\/\/www\.knesset\.tv)?\/tv-shows\/([A-Za-z0-9_-]+)\/$/;

/** "/tv-shows/the-scale/video/89510/" -> "video_89510"; nested "/tv-shows/39011/39012/45965/" -> "39012_45965". */
export function episodeIdFromHref(showId: string, href: string): string | undefined {
  const path = href.replace(/^https:\/\/www\.knesset\.tv/, "");
  const prefix = `/tv-shows/${showId}/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length).replace(/\/$/, "");
  if (!rest || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(rest) || !/\d/.test(rest)) return undefined;
  return rest.split("/").join("_");
}

function episodeUrl(showId: string, episodeId: string): string {
  return `${SITE}/tv-shows/${showId}/${episodeId.split("_").join("/")}/`;
}

/** "14.01.26 11:19" (Israel time) -> ISO timestamp. */
function parseListDate(s: string): string | undefined {
  const day = parseDayFirstDate(s);
  const time = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!day || !time) return day;
  // Israel is UTC+2/+3; using +2 keeps the date right for evening broadcasts.
  return new Date(Date.parse(day) + (Number(time[1]) - 2) * 3600_000 + Number(time[2]) * 60_000).toISOString();
}

/** Show cards on a listing page: link, poster and title. */
export function parseShowCards(html: string, pageUrl: string): VodProgram[] {
  const out = new Map<string, VodProgram>();
  for (const a of anchors(html, SHOW_HREF)) {
    const id = a.href.match(SHOW_HREF)![1]!;
    const img = a.inner.match(/<img\s[^>]*>/i)?.[0];
    const title = img ? attr(img, "alt")?.trim() : undefined;
    // Banner links say "לצפייה" (watch) and have no title; the poster card comes later on the page.
    if (!title || title === "slide-image" || out.has(id)) continue;
    out.set(id, {
      id,
      provider: PROVIDER,
      kind: "series",
      title,
      poster: firstImage(a.inner, pageUrl),
      posterShape: "poster",
      genres: ["Parliament", "Current Affairs"],
      language: "he",
      website: `${SITE}/tv-shows/${id}/`,
      geo: "unknown",
    });
  }
  return [...out.values()];
}

interface ListedEpisode {
  id: string;
  title: string;
  thumbnail?: string;
  released?: string;
}

/** Episodes on one show page, and the link to the next page if there is one. */
export function parseShowPage(html: string, showId: string, pageUrl: string): { episodes: ListedEpisode[]; next?: string } {
  const start = html.indexOf('id="episodes-block"');
  const block = start === -1 ? html : html.slice(start);
  const episodes: ListedEpisode[] = [];
  const seen = new Set<string>();
  for (const a of anchors(block, /^(?:https:\/\/www\.knesset\.tv)?\/tv-shows\//)) {
    const id = episodeIdFromHref(showId, a.href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const title = textOf(a.inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]) || attr(a.inner.match(/<img\s[^>]*>/i)?.[0] ?? "", "alt") || "";
    if (!title) continue;
    const date = textOf(a.inner.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    episodes.push({ id, title, thumbnail: firstImage(a.inner, pageUrl), released: parseListDate(date) });
  }
  const nextTag = html.match(/<a\s[^>]*id="showMoreEpisodeBtn"[^>]*>/i)?.[0];
  const nextHref = nextTag ? attr(nextTag, "href") : undefined;
  return { episodes, next: nextHref ? absoluteUrl(nextHref, pageUrl) : undefined };
}

/** TVSeries JSON-LD block of a show page. */
function seriesInfo(html: string): { name?: string; description?: string; image?: string } {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]!) as Record<string, unknown>;
      if (data["@type"] === "TVSeries") {
        const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string).trim() : undefined);
        return { name: str("name"), description: str("description"), image: str("image") };
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return {};
}

/** The episode's own manifest on a video page, ignoring the live channel player every page also embeds. */
export function episodeManifest(html: string, pageUrl: string): string | undefined {
  const urls = extractManifestUrls(html, pageUrl)
    .map((u) => {
      // The site's player is embedded as watch.knesset.tv?src=<manifest>.
      const url = new URL(u);
      return url.hostname === "watch.knesset.tv" ? url.searchParams.get("src") ?? "" : u;
    })
    .filter((u) => /^https:\/\/[^\s]+\.m3u8(\?|$)/.test(u));
  return urls.find((u) => /bynetcdn\.com/.test(u)) ?? urls.find((u) => !/gostreaming\.tv/.test(u));
}

/**
 * Knesset Channel VOD from knesset.tv: TV shows and their episodes. Video pages carry a plain HLS manifest
 * on Bynet's CDN that plays outside Israel too (decoded from GitHub's US runners, 25 Oct 2026).
 */
export class KnessetVod implements VodCapability {
  private programsById = new Map<string, VodProgram>();
  private listedIds = new Set<string>();
  /** Shows found through the sitemap that no listing page links to, and when they were last looked up. */
  private fromSitemap = new Map<string, VodProgram>();
  private sitemapReadAt = 0;
  private sitemapRun?: Promise<void>;
  /** Older episodes of long shows (pages 1 and later), so a request only has to read the first page again. */
  private showEpisodes = new Map<string, ShowEpisodes>();
  private fills = new Map<string, Promise<void>>();

  constructor(private readonly cfg: KnessetVodConfig) {}

  private get(url: string, ctx: ProviderContext) {
    return getText(url, { timeoutMs: ctx.config.requestTimeoutMs, fetch: ctx.fetch, signal: ctx.signal, retries: 2, retryDelayMs: 1500 });
  }

  async listPrograms(ctx: ProviderContext): Promise<VodProgram[]> {
    const pages = await Promise.allSettled(this.cfg.showPages.map((u) => this.get(u, ctx)));
    const out = new Map<string, VodProgram>();
    pages.forEach((r, i) => {
      if (r.status === "rejected") {
        ctx.logger.warn("Knesset show list failed", { page: this.cfg.showPages[i], error: errorMessage(r.reason) });
        return;
      }
      for (const p of parseShowCards(r.value.text, r.value.finalUrl)) if (!out.has(p.id)) out.set(p.id, p);
    });
    if (pages.length && pages.every((p) => p.status === "rejected")) throw new Error("all Knesset show pages failed");
    this.listedIds = new Set(out.keys());
    this.refreshSitemapInBackground(ctx);
    for (const [id, p] of this.fromSitemap) if (!out.has(id)) out.set(id, p);
    this.programsById = out;
    return [...out.values()];
  }

  /** Reads the show sitemap and the page of every show that the listing pages do not link to. */
  discoverFromSitemap(ctx: ProviderContext): Promise<void> {
    this.sitemapRun ??= this.readSitemap(ctx).finally(() => {
      this.sitemapRun = undefined;
      this.sitemapReadAt ||= Date.now();
    });
    return this.sitemapRun;
  }

  private async readSitemap(ctx: ProviderContext): Promise<void> {
    const slugs = new Set<string>();
    for (const sitemap of this.cfg.sitemaps ?? []) {
      try {
        for (const loc of await sitemapLocs(sitemap, async (u) => (await this.get(u, ctx)).text)) {
          const m = loc.match(SHOW_HREF);
          if (m) slugs.add(m[1]!);
        }
      } catch (err) {
        ctx.logger.warn("Knesset sitemap failed", { sitemap, error: errorMessage(err) });
      }
    }
    const found = new Map<string, VodProgram>();
    await mapPool([...slugs].filter((id) => !this.listedIds.has(id)), 2, async (id) => {
      try {
        const res = await this.get(`${SITE}/tv-shows/${id}/`, ctx);
        if (!res.finalUrl.includes(`/tv-shows/${id}/`)) return; // retired shows redirect to the index
        const info = seriesInfo(res.text);
        if (!info.name || parseShowPage(res.text, id, res.finalUrl).episodes.length === 0) return;
        found.set(id, {
          id,
          provider: PROVIDER,
          kind: "series",
          title: info.name,
          poster: info.image ?? metaContent(res.text, "og:image"),
          posterShape: "poster",
          description: info.description,
          genres: ["Parliament", "Current Affairs"],
          language: "he",
          website: `${SITE}/tv-shows/${id}/`,
          geo: "unknown",
        });
      } catch (err) {
        ctx.logger.debug("Knesset show page failed", { id, error: errorMessage(err) });
      }
    });
    this.fromSitemap = found;
    this.sitemapReadAt = Date.now();
  }

  private refreshSitemapInBackground(ctx: ProviderContext): void {
    if (!this.cfg.sitemaps?.length || this.sitemapRun || Date.now() - this.sitemapReadAt < SITEMAP_REFRESH_MS) return;
    // Not tied to the request that started it.
    this.discoverFromSitemap({ ...ctx, signal: new AbortController().signal }).catch((err) => ctx.logger.warn("Knesset sitemap discovery failed", { error: errorMessage(err) }));
  }

  async getProgram(programId: string, ctx: ProviderContext): Promise<VodProgramDetail | undefined> {
    if (!this.programsById.has(programId)) await this.listPrograms(ctx).catch(() => []);
    const first = await this.get(`${SITE}/tv-shows/${programId}/`, ctx);
    // Retired shows redirect to the show index.
    if (!first.finalUrl.includes(`/tv-shows/${programId}/`)) return undefined;
    const firstPage = first.text;
    const info = seriesInfo(firstPage);
    const page0 = parseShowPage(firstPage, programId, first.finalUrl);
    const listed: ListedEpisode[] = [...page0.episodes];
    const seen = new Set(listed.map((e) => e.id));
    const merge = (older: ListedEpisode[]) => {
      for (const e of older) if (!seen.has(e.id)) (seen.add(e.id), listed.push(e));
    };
    let partial = false;
    const known = this.showEpisodes.get(programId);
    if (page0.next === undefined || listed.length === 0) {
      // A single page holds the whole show.
    } else if ((known?.complete && Date.now() - known.readAt < SHOW_EPISODES_TTL_MS) || this.fills.has(programId)) {
      // Older pages were read before (or are being read): only the first page is fetched fresh.
      merge(known?.episodes ?? []);
      partial = !known?.complete;
    } else {
      // Long-running shows have 80+ pages, more than fit in one request's time budget. Read what fits,
      // return it, and read the rest in the background for the next request.
      const stopAt = ctx.deadline ? ctx.deadline - DEADLINE_MARGIN_MS : Infinity;
      const done = await this.readOlderPages(programId, listed, seen, ctx, stopAt);
      if (done) this.showEpisodes.set(programId, { episodes: listed.slice(page0.episodes.length), complete: true, readAt: Date.now() });
      else {
        partial = true;
        this.fillInBackground(programId, ctx);
      }
    }
    const base = this.programsById.get(programId);
    if (!base && !info.name) return undefined;
    // Pages list the newest first; Stremio wants episode 1 first.
    const chronological = listed.reverse().sort((a, b) => (a.released && b.released ? a.released.localeCompare(b.released) : 0));
    const episodes: VodEpisode[] = assignEpisodeNumbers(chronological, (e) => episodeNumberFromTitle(e.title)).map((e) => ({
      id: e.id,
      season: 1,
      episode: e.episode,
      title: e.title,
      released: e.released,
      thumbnail: e.thumbnail,
    }));
    const poster = base?.poster ?? info.image ?? metaContent(firstPage, "og:image");
    return {
      ...(base ?? {
        id: programId,
        provider: PROVIDER,
        kind: "series" as const,
        genres: ["Parliament", "Current Affairs"],
        language: "he",
        website: `${SITE}/tv-shows/${programId}/`,
        geo: "unknown" as const,
      }),
      title: base?.title ?? info.name!,
      poster,
      background: info.image ?? poster,
      description: info.description,
      updatedAt: chronological.length ? Date.parse(chronological[chronological.length - 1]!.released ?? "") || undefined : undefined,
      episodes: episodes.sort((a, b) => a.episode - b.episode),
      partial: partial || undefined,
    };
  }

  /**
   * Reads show pages 1, 2, ... (newest to oldest) into `listed`, a batch at a time. Returns true when the last
   * page was read, false when it stopped at `stopAt` first. A failing page ends the list there.
   */
  private async readOlderPages(programId: string, listed: ListedEpisode[], seen: Set<string>, ctx: ProviderContext, stopAt = Infinity): Promise<boolean> {
    for (let page = 1; page < this.cfg.maxEpisodePages; page += PAGE_BATCH) {
      if (Date.now() >= stopAt) return false;
      const numbers = Array.from({ length: Math.min(PAGE_BATCH, this.cfg.maxEpisodePages - page) }, (_, i) => page + i);
      const results = await Promise.allSettled(numbers.map((n) => this.get(`${SITE}/tv-shows/${programId}/?page=${n}`, ctx)));
      for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
          if (ctx.signal.aborted) return false;
          ctx.logger.warn("Knesset show page failed; keeping episodes read so far", { programId, page: numbers[i], error: errorMessage(r.reason) });
          return true;
        }
        const parsed = parseShowPage(r.value.text, programId, r.value.finalUrl);
        const fresh = parsed.episodes.filter((e) => !seen.has(e.id));
        fresh.forEach((e) => seen.add(e.id));
        listed.push(...fresh);
        if (fresh.length === 0 || !parsed.next) return true;
      }
    }
    return true;
  }

  /** Reads every page of a long show, not tied to the request that started it, saving progress as it goes. */
  private fillInBackground(programId: string, ctx: ProviderContext): void {
    if (this.fills.has(programId)) return;
    const own: ProviderContext = { ...ctx, signal: new AbortController().signal, deadline: undefined };
    const listed: ListedEpisode[] = [];
    const seen = new Set<string>();
    const entry: ShowEpisodes = { episodes: listed, complete: false, readAt: Date.now() };
    this.showEpisodes.set(programId, entry);
    const run = this.readOlderPages(programId, listed, seen, own)
      .then(() => {
        entry.complete = true;
        entry.readAt = Date.now();
        own.logger.info("Knesset show read in the background", { programId, episodes: listed.length });
      })
      .catch((err) => {
        this.showEpisodes.delete(programId);
        own.logger.warn("Knesset background read failed", { programId, error: errorMessage(err) });
      })
      .finally(() => this.fills.delete(programId));
    this.fills.set(programId, run);
  }

  async resolveEpisodeStreams(programId: string, episodeId: string, ctx: ProviderContext): Promise<ResolvedStream[]> {
    const { text, finalUrl } = await this.get(episodeUrl(programId, episodeId), ctx);
    const url = episodeManifest(text, finalUrl);
    if (!url) {
      ctx.logger.warn("no manifest on Knesset video page", { programId, episodeId });
      return [];
    }
    return [{ url, format: "hls", label: "Auto", source: "knesset-video-page", geo: "unknown" }];
  }
}
