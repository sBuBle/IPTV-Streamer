import type { ResolvedStream } from "../../domain/types.js";
import { extractManifestUrls } from "../../media/extract.js";
import { absoluteUrl, anchors, attr, firstImage, metaContent, textOf } from "../../util/html.js";
import { getText } from "../../util/http.js";
import { errorMessage } from "../registry.js";
import type { ProviderContext, VodCapability, VodEpisode, VodProgram, VodProgramDetail } from "../types.js";
import { assignEpisodeNumbers, episodeNumberFromTitle, parseDayFirstDate } from "../vod-util.js";

const PROVIDER = "knesset";
const SITE = "https://www.knesset.tv";

export interface KnessetVodConfig {
  /** Pages that list the TV shows as cards (knesset.tv/tv-shows/, knesset.tv/vod/). */
  showPages: string[];
  /** Show pages hold 12 episodes each; at most this many pages are read per show. */
  maxEpisodePages: number;
}

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
  const urls = extractManifestUrls(html, pageUrl).filter((u) => /\.m3u8(\?|$)/.test(u));
  return urls.find((u) => /bynetcdn\.com/.test(u)) ?? urls.find((u) => !/gostreaming\.tv/.test(u));
}

/**
 * Knesset Channel VOD from knesset.tv: TV shows and their episodes. Video pages carry a plain HLS manifest
 * on Bynet's CDN that plays outside Israel too (decoded from GitHub's US runners, 25 Oct 2026).
 */
export class KnessetVod implements VodCapability {
  private programsById = new Map<string, VodProgram>();

  constructor(private readonly cfg: KnessetVodConfig) {}

  private get(url: string, ctx: ProviderContext) {
    return getText(url, { timeoutMs: ctx.config.requestTimeoutMs, fetch: ctx.fetch, signal: ctx.signal, retries: 1 });
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
    this.programsById = out;
    return [...out.values()];
  }

  async getProgram(programId: string, ctx: ProviderContext): Promise<VodProgramDetail | undefined> {
    if (!this.programsById.has(programId)) await this.listPrograms(ctx).catch(() => []);
    let url: string | undefined = `${SITE}/tv-shows/${programId}/`;
    const listed: ListedEpisode[] = [];
    let info: ReturnType<typeof seriesInfo> = {};
    let firstPage = "";
    for (let page = 0; url && page < this.cfg.maxEpisodePages; page++) {
      let res: { text: string; finalUrl: string };
      try {
        res = await this.get(url, ctx);
      } catch (err) {
        if (page === 0) throw err;
        ctx.logger.warn("Knesset show page failed; keeping episodes read so far", { url, error: errorMessage(err) });
        break;
      }
      if (page === 0) {
        firstPage = res.text;
        info = seriesInfo(res.text);
      }
      const parsed = parseShowPage(res.text, programId, res.finalUrl);
      const fresh = parsed.episodes.filter((e) => !listed.some((l) => l.id === e.id));
      if (fresh.length === 0) break;
      listed.push(...fresh);
      url = parsed.next;
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
    };
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
