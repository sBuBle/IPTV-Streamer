import type { Config } from "../../config.js";
import type { ResolvedStream } from "../../domain/types.js";
import { anchors, attr, decodeEntities, firstImage, metaContent, textOf } from "../../util/html.js";
import { getText } from "../../util/http.js";
import { mapPool } from "../../util/pool.js";
import { sitemapLocs } from "../../util/sitemap.js";
import { errorMessage } from "../registry.js";
import type { ProviderAdapter, ProviderContext, ProviderIssue, VodEpisode, VodProgram, VodProgramDetail } from "../types.js";
import { assignEpisodeNumbers, episodeNumberFromTitle, parseClock } from "../vod-util.js";

const PROVIDER = "kan";
const SITE = "https://www.kan.org.il";
/** Seasons are separate pages; a program with more than this many is cut, newest kept. */
const MAX_SEASON_PAGES = 30;

/** Kan's lobby section titles -> catalog genres. Curated rows ("new", "most watched") carry no genre. */
const SECTION_GENRES: Array<[RegExp, string[]]> = [
  [/דרמה/, ["Drama"]],
  [/קומדיה|סאטירה/, ["Comedy"]],
  [/דוקו ריאליטי|ריאליטי/, ["Reality", "Documentary"]],
  [/דוקו|תיעודי/, ["Documentary"]],
  [/חו"ל|לא מכאן/, ["Foreign"]],
  [/מוזיקה/, ["Music"]],
  [/בידור|שעשועון|מפעילים את המוח/, ["Entertainment"]],
  [/תרבות/, ["Culture"]],
  [/אוכל|בישול/, ["Food"]],
  [/פשע/, ["Crime"]],
  [/יהדות|מורשת/, ["Judaism"]],
  [/ילדים|נוער/, ["Kids"]],
  [/אקטואליה|כתבות|חדשות/, ["Current Affairs"]],
  [/מדע/, ["Science"]],
  [/אירוח|טוק/, ["Talk"]],
];

export function genresFor(labels: string[]): string[] {
  const out = new Set<string>();
  for (const label of labels) for (const [re, genres] of SECTION_GENRES) if (re.test(label)) genres.forEach((g) => out.add(g));
  return [...out].sort();
}

const PROGRAM_HREF = /^https:\/\/www\.kan\.org\.il\/content\/([a-z0-9/_-]+)\/p-(\d+)\/$/i;
/** Radio stations and podcasts share Kan's lobbies with TV; they are audio, so they stay out of the catalog. */
const AUDIO_SECTION = /^(?:kan\/(?:podcasts|kan-b|kan-gimel|kan-88|kan-music|kan-tarbut|kan-reka|kan-moreshet|radio_articles)|archive1\/podcast_archive)$/i;
/** Sitemap sections that hold TV programs. Radio, podcasts, articles and event microsites are left out. */
const SITEMAP_TV_PROGRAM = /^https:\/\/www\.kan\.org\.il\/content\/(?:kan\/kan-11|kan\/news-series|kan\/kan-actual|kan-news\/newstv|dig\/digital|archive1\/vod)\/p-(\d+)\/(.*)$/;
/** Programs found through the sitemap are looked up again after this long. */
const SITEMAP_REFRESH_MS = 24 * 3600_000;
/** Lobbies that list only films ("סרטים"). */
const FILM_LOBBY = /\/lobby\/(?:%D7%A1%D7%A8%D7%98%D7%99%D7%9D|סרטים)\//i;

interface ListedProgram extends VodProgram {
  url: string;
}

/**
 * Program cards on a Kan lobby page. Each card sits under a section heading (Drama, Comedy, Documentary films...),
 * which gives the genres and tells films from series.
 */
export function parseLobby(html: string, lobbyUrl = ""): ListedProgram[] {
  const filmLobby = FILM_LOBBY.test(lobbyUrl);
  const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => ({ index: m.index, text: textOf(m[1]) })).filter((h) => h.text);
  const sectionAt = (index: number) => {
    let current: string | undefined;
    for (const h of headings) {
      if (h.index > index) break;
      current = h.text;
    }
    return current;
  };
  const byId = new Map<string, ListedProgram & { sections: Set<string> }>();
  for (const a of anchors(html, PROGRAM_HREF)) {
    if (!/<img\s/i.test(a.inner)) continue; // menu links have no poster
    const [, contentPath, id] = a.href.match(PROGRAM_HREF) as unknown as [string, string, string];
    if (AUDIO_SECTION.test(contentPath)) continue;
    const img = a.inner.match(/<img\s[^>]*>/i)![0];
    const title = (attr(a.tag, "aria-label") || textOf(a.inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]) || attr(img, "alt") || "").trim();
    if (!title) continue;
    const section = sectionAt(a.index);
    const existing = byId.get(id);
    if (existing) {
      if (section) existing.sections.add(section);
      continue;
    }
    const subtitle = textOf(a.inner.match(/<p[^>]*class="[^"]*cr-subtitle[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    byId.set(id, {
      id,
      provider: PROVIDER,
      kind: "series",
      title,
      poster: firstImage(a.inner, SITE)?.replace(/([?&])width=\d+&(amp;)?height=\d+/, "$1width=600&height=900"),
      posterShape: "poster",
      description: subtitle || undefined,
      genres: [],
      language: "he",
      website: a.href,
      geo: "israel-only",
      url: a.href,
      sections: new Set(section ? [section] : []),
    });
  }
  return [...byId.values()].map(({ sections, ...p }) => {
    const labels = [...sections];
    const film = filmLobby || (labels.some((l) => /סרט/.test(l)) && !labels.some((l) => /סדר/.test(l)));
    return { ...p, kind: film ? "movie" : "series", genres: genresFor(labels) };
  });
}

interface ListedEpisode {
  /** Path segment between program and episode: "s3" (season 3), a named sub-section such as "new_chefs", or "" for none. */
  segment: string;
  kanId: string;
  title: string;
  thumbnail?: string;
  description?: string;
  durationSec?: number;
}

/** Card subtitles that only repeat "season 1, episode 2" say nothing Stremio does not show already. */
function episodeSubtitle(s: string): string | undefined {
  return !s || /^עונה\s*\d+\s*,\s*פרק\s*\d+$/.test(s) ? undefined : s;
}

const episodeHref = (programId: string) => new RegExp(`/p-${programId}/(?:([a-z0-9_]+)/)?(\\d+)/$`, "i");

/** Season number of a path segment: "s3" -> 3, none -> 0, named sub-section -> undefined. */
function segmentSeason(segment: string): number | undefined {
  if (!segment) return 0;
  const m = segment.match(/^s(\d+)$/i);
  return m ? Number(m[1]) : undefined;
}

/** Episode cards of one program found in a page fragment. */
export function parseEpisodeCards(html: string, programId: string, onlySeason?: number): ListedEpisode[] {
  const re = episodeHref(programId);
  const out: ListedEpisode[] = [];
  const seen = new Set<string>();
  for (const a of anchors(html, re)) {
    const m = a.href.match(re)!;
    const segment = (m[1] ?? "").toLowerCase();
    const kanId = m[2]!;
    if ((onlySeason !== undefined && segmentSeason(segment) !== onlySeason) || seen.has(kanId)) continue;
    const title = (textOf(a.inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]) || attr(a.tag, "aria-label") || "").trim();
    if (!title || !/<img\s/i.test(a.inner)) continue; // the hero "watch" button is not an episode card
    seen.add(kanId);
    out.push({
      segment,
      kanId,
      title,
      thumbnail: firstImage(a.inner, SITE)?.replace(/([?&])width=\d+&(amp;)?height=\d+/, "$1width=960&height=540"),
      description: episodeSubtitle(textOf(a.inner.match(/<p[^>]*class="[^"]*cr-subtitle[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1])),
      durationSec: parseClock(textOf(a.inner.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1])),
    });
  }
  return out;
}

/** The video behind the hero "watch" button of a program page. */
export function heroVideo(html: string, programId: string): { segment: string; kanId: string } | undefined {
  const re = episodeHref(programId);
  const a = anchors(html, re).find((x) => /hero-vod-cta/.test(attr(x.tag, "class") ?? ""));
  const m = a?.href.match(re);
  return m ? { segment: (m[1] ?? "").toLowerCase(), kanId: m[2]! } : undefined;
}

/**
 * Seasons of the older program layout: each `seasons-item` block with its id, and whether it is the program's
 * first (oldest) season. The page shows the newest seasons; the rest load one at a time via "load more".
 */
export function parseSeasonItems(html: string): Array<{ id: string; first: boolean }> {
  return [...html.matchAll(/<div class="seasons-item" data-season-id="(\d+)" data-is-first-season="(true|false)"/gi)].map((m) => ({ id: m[1]!, first: m[2]!.toLowerCase() === "true" }));
}

/** Episode id prefix of a path segment. Numbered seasons stay numbers ("3-1098375"), as ids were before named sub-sections. */
function episodeSegmentId(segment: string): string {
  const n = segmentSeason(segment);
  return n !== undefined ? String(n) : segment;
}

/** Inverse of episodeSegmentId: the URL path piece for an episode id prefix. */
function episodePathSegment(prefix: string): string {
  if (/^\d+$/.test(prefix)) return prefix === "0" ? "" : `s${prefix}/`;
  return `${prefix.toLowerCase()}/`;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

/** Season tabs of the newer program layout: season number -> season page URL, and the season shown on this page. */
export function parseSeasonTabs(html: string, programId: string): { seasons: Map<number, string>; active?: number } {
  const re = new RegExp(`/p-${programId}/s(\\d+)/$`);
  const seasons = new Map<number, string>();
  let active: number | undefined;
  for (const a of anchors(html, re)) {
    if (!/program-season-tab/.test(attr(a.tag, "class") ?? "")) continue;
    const n = Number(a.href.match(re)![1]);
    seasons.set(n, a.href);
    if (/is-active/.test(attr(a.tag, "class") ?? "")) active = n;
  }
  return { seasons, active };
}

/** The part of a program page that lists its episodes, so related programs further down are not picked up. */
function episodesRegion(html: string): string {
  const start = [html.indexOf('id="program-episodes"'), html.indexOf('class="seasons"')].filter((i) => i >= 0);
  return start.length ? html.slice(Math.min(...start)) : html;
}

/** Reads the JSON object that starts at `start` (a "{"), respecting strings. */
function jsonObjectAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return undefined;
}

interface RedgeConfig {
  file?: { hls?: string | null; dash?: string | null } | null;
  drm?: { widevine?: unknown; fairplay?: { src?: unknown } | null } | null;
  isLive?: boolean;
}

/** The Redge player configuration embedded in an episode page. */
export function parsePlayerConfig(html: string): RedgeConfig | undefined {
  const start = html.indexOf('{"containerId":"redge-player-');
  if (start === -1) return undefined;
  try {
    return jsonObjectAt(html, start) as RedgeConfig;
  } catch {
    return undefined;
  }
}

/**
 * A program's catalog entry read from its own page, for programs that no lobby lists. Undefined when the page
 * holds no video (no player, no episode list).
 */
export function programFromPage(html: string, id: string, url: string): ListedProgram | undefined {
  const tabs = parseSeasonTabs(html, id);
  const cards = parseEpisodeCards(episodesRegion(html), id);
  const hero = heroVideo(html, id);
  if (!tabs.seasons.size && !cards.length && !hero) return undefined;
  const npawTitle = html.match(/npawData\.program\s*=\s*decodeEntities\('((?:[^'\\]|\\.)*)'\)/)?.[1];
  const ogTitle = textOf(decodeEntities(metaContent(html, "og:title") ?? "")).split(/\s+[|–-]\s+/)[0];
  const title = textOf(decodeEntities(npawTitle ?? "")) || ogTitle;
  if (!title) return undefined;
  const pageGenres = [...html.matchAll(/<div class="info-genre[\s\S]*?<\/ul>/gi)].flatMap((m) => [...m[0].matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((li) => textOf(li[1])));
  const programGenre = html.match(/program_genre:\s*'([^']*)'/)?.[1];
  const image = metaContent(html, "og:image");
  return {
    id,
    provider: PROVIDER,
    // One video and no episode list: a film or a one-off special.
    kind: !tabs.seasons.size && !cards.length ? "movie" : "series",
    title,
    poster: image ? new URL(decodeEntities(image), SITE).toString() : undefined,
    posterShape: "landscape",
    description: textOf(decodeEntities(metaContent(html, "og:description") ?? "")) || undefined,
    genres: genresFor([...pageGenres, ...(programGenre ? [decodeEntities(programGenre)] : [])]),
    language: "he",
    website: url,
    geo: "israel-only",
    url,
  };
}

function https(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("//") ? `https:${url}` : url;
}

/**
 * Kan (Israeli Public Broadcasting) VOD from kan.org.il. The catalog is read from the lobby pages and every
 * program page lists its seasons and episodes. Episode pages embed the Redge player with plain HLS and DASH
 * manifests. Redge's CDN answers 403 outside Israel, so these streams are Israel-only and can only be
 * verified from an Israeli host.
 */
export class KanAdapter implements ProviderAdapter {
  readonly id = PROVIDER;
  readonly name = "Kan";
  private programs = new Map<string, ListedProgram>();
  private lobbyIds = new Set<string>();
  /** Programs found through the sitemap that no lobby lists, and when they were last looked up. */
  private fromSitemap = new Map<string, ListedProgram>();
  /** Episode URLs in the sitemap: program id -> path segment -> Kan ids. Fills lists that Kan's pages cut at 50. */
  private sitemapEpisodes = new Map<string, Map<string, string[]>>();
  private sitemapReadAt = 0;
  private sitemapRun?: Promise<void>;

  constructor(private readonly cfg: Config["providers"]["kan"]) {}

  issues(): ProviderIssue[] {
    return this.cfg.lobbies.length ? [] : [{ severity: "error", message: "KAN_LOBBIES is empty" }];
  }

  private get(url: string, ctx: ProviderContext) {
    return getText(url, { timeoutMs: ctx.config.requestTimeoutMs, fetch: ctx.fetch, signal: ctx.signal, retries: 1 });
  }

  /**
   * Finds TV programs in Kan's sitemap that no lobby links to and reads each one's page for its title and poster.
   * Several hundred requests, so listPrograms runs it in the background once a day; the first catalog request
   * returns the lobby programs only.
   */
  discoverFromSitemap(ctx: ProviderContext): Promise<void> {
    this.sitemapRun ??= this.readSitemap(ctx).finally(() => {
      this.sitemapRun = undefined;
      this.sitemapReadAt ||= Date.now();
    });
    return this.sitemapRun;
  }

  private async readSitemap(ctx: ProviderContext): Promise<void> {
    const get = async (u: string) => (await getText(u, { timeoutMs: Math.max(ctx.config.requestTimeoutMs, 60_000), fetch: ctx.fetch, signal: ctx.signal, retries: 1 })).text;
    const roots = new Map<string, string>();
    const withEpisodes = new Set<string>();
    const episodes = new Map<string, Map<string, string[]>>();
    for (const sitemap of this.cfg.sitemaps) {
      let locs: string[];
      try {
        locs = await sitemapLocs(sitemap, get);
      } catch (err) {
        ctx.logger.warn("Kan sitemap failed", { sitemap, error: errorMessage(err) });
        continue;
      }
      for (const loc of locs) {
        const m = loc.match(SITEMAP_TV_PROGRAM);
        if (!m) continue;
        if (m[2]) withEpisodes.add(m[1]!);
        const ep = m[2]!.match(/^(?:([a-z0-9_]+)\/)?(\d+)\/$/i);
        if (ep) {
          const bySegment = episodes.get(m[1]!) ?? new Map<string, string[]>();
          const segment = (ep[1] ?? "").toLowerCase();
          bySegment.set(segment, [...(bySegment.get(segment) ?? []), ep[2]!]);
          episodes.set(m[1]!, bySegment);
        }
        else roots.set(m[1]!, loc);
      }
    }
    const wanted = [...roots].filter(([id]) => withEpisodes.has(id) && !this.lobbyIds.has(id));
    const found = new Map<string, ListedProgram>();
    await mapPool(wanted, 6, async ([id, url]) => {
      try {
        const res = await this.get(url, ctx);
        if (res.finalUrl.replace(/\/?$/, "/") !== url) return; // moved or retired
        const program = programFromPage(res.text, id, url);
        if (program) found.set(id, program);
      } catch (err) {
        ctx.logger.debug("Kan program page failed", { url, error: errorMessage(err) });
      }
    });
    this.fromSitemap = found;
    this.sitemapEpisodes = episodes;
    this.sitemapReadAt = Date.now();
    ctx.logger.info("Kan sitemap read", { candidates: wanted.length, programs: found.size });
  }

  private refreshSitemapInBackground(ctx: ProviderContext): void {
    if (!this.cfg.sitemaps.length || this.sitemapRun || Date.now() - this.sitemapReadAt < SITEMAP_REFRESH_MS) return;
    // Not tied to the request that started it.
    const own = { ...ctx, signal: new AbortController().signal };
    this.discoverFromSitemap(own).catch((err) => ctx.logger.warn("Kan sitemap discovery failed", { error: errorMessage(err) }));
  }

  /** Older-layout seasons that the program page leaves to "load more": one request per season, newest to oldest. */
  private async olderSeasons(url: string, html: string, programId: string, ctx: ProviderContext): Promise<ListedEpisode[]> {
    const shown = parseSeasonItems(html);
    if (!shown.length || shown.some((x) => x.first) || !html.includes('id="vod-program-show-more"')) return [];
    const seen = new Set(shown.map((x) => x.id));
    let last = shown[shown.length - 1]!.id;
    const out: ListedEpisode[] = [];
    for (let page = 2; page < MAX_SEASON_PAGES + 2; page++) {
      let text: string;
      try {
        ({ text } = await this.get(`${url}?page=${page}&itemsToShow=500&lastLoadedSeasonId=${last}`, ctx));
      } catch (err) {
        ctx.logger.warn("Kan season load failed; keeping seasons read so far", { programId, after: last, error: errorMessage(err) });
        break;
      }
      const loaded = parseSeasonItems(text).filter((x) => !seen.has(x.id));
      if (!loaded.length) break;
      out.push(...parseEpisodeCards(episodesRegion(text), programId));
      loaded.forEach((x) => seen.add(x.id));
      const oldest = loaded[loaded.length - 1]!;
      if (oldest.first) break;
      last = oldest.id;
    }
    return out;
  }

  private async programUrl(programId: string, ctx: ProviderContext): Promise<string | undefined> {
    if (!this.programs.has(programId)) await this.vod.listPrograms(ctx).catch(() => []);
    return this.programs.get(programId)?.url;
  }

  readonly vod = {
    listPrograms: async (ctx: ProviderContext): Promise<VodProgram[]> => {
      const pages = await Promise.allSettled(this.cfg.lobbies.map((u) => this.get(u, ctx)));
      const out = new Map<string, ListedProgram>();
      pages.forEach((r, i) => {
        if (r.status === "rejected") {
          ctx.logger.warn("Kan lobby failed", { lobby: this.cfg.lobbies[i], error: errorMessage(r.reason) });
          return;
        }
        for (const p of parseLobby(r.value.text, this.cfg.lobbies[i])) {
          const prev = out.get(p.id);
          if (!prev) out.set(p.id, p);
          else {
            prev.genres = [...new Set([...prev.genres, ...p.genres])].sort();
            if (p.kind === "movie") prev.kind = "movie";
          }
        }
      });
      if (pages.every((p) => p.status === "rejected")) throw new Error("all Kan lobbies failed");
      this.lobbyIds = new Set(out.keys());
      this.programs = out;
      this.refreshSitemapInBackground(ctx);
      for (const [id, p] of this.fromSitemap) if (!out.has(id)) out.set(id, p);
      return [...out.values()].map(({ url: _url, ...p }) => p);
    },

    getProgram: async (programId: string, ctx: ProviderContext): Promise<VodProgramDetail | undefined> => {
      const url = await this.programUrl(programId, ctx);
      if (!url) return undefined;
      const { text } = await this.get(url, ctx);
      const listed = this.programs.get(programId)!;

      const tabs = parseSeasonTabs(text, programId);
      let cards: ListedEpisode[];
      if (tabs.seasons.size > 0) {
        cards = tabs.active !== undefined ? parseEpisodeCards(episodesRegion(text), programId, tabs.active) : [];
        const others = [...tabs.seasons.entries()].filter(([n]) => n !== tabs.active).sort((a, b) => b[0] - a[0]).slice(0, MAX_SEASON_PAGES);
        const pages = await Promise.allSettled(others.map(([, u]) => this.get(u, ctx)));
        pages.forEach((r, i) => {
          const n = others[i]![0];
          if (r.status === "fulfilled") cards.push(...parseEpisodeCards(episodesRegion(r.value.text), programId, n));
          else ctx.logger.warn("Kan season page failed", { programId, season: n, error: errorMessage(r.reason) });
        });
      } else {
        cards = parseEpisodeCards(episodesRegion(text), programId);
        cards.push(...(await this.olderSeasons(url, text, programId, ctx)));
      }
      // Kan's pages show at most 50 episodes per row and some seasons not at all; the sitemap lists every
      // episode URL (without titles). Its extra episodes are added to the seasons and sub-sections it names, and
      // to unsectioned lists only when the page itself lists unsectioned episodes, so trailers never turn a film
      // into a series.
      const listedSegments = new Set(cards.map((c) => c.segment));
      for (const [segment, ids] of this.sitemapEpisodes.get(programId) ?? []) {
        if (segment || listedSegments.has("")) for (const kanId of ids) cards.push({ segment, kanId, title: "" });
      }
      cards = uniqueBy(cards, (c) => c.kanId);
      // Unsectioned links are extras next to real seasons; they are the episodes only when nothing else exists.
      if (cards.some((c) => c.segment)) cards = cards.filter((c) => c.segment);
      // Single-video programs (films, specials) have no episode list, only the hero "watch" button.
      if (cards.length === 0) {
        const cta = heroVideo(text, programId);
        if (cta) cards = [{ ...cta, title: listed.title }];
      }

      // Numbered seasons keep their number; named sub-sections ("new_chefs") follow as extra seasons, in page order.
      const seasonOf = new Map<string, number>();
      for (const c of cards) {
        const n = segmentSeason(c.segment);
        if (n !== undefined) seasonOf.set(c.segment, n || 1);
      }
      const seasonNames: Record<number, string> = {};
      let nextSeason = Math.max(0, ...seasonOf.values()) + 1;
      for (const c of cards) {
        if (seasonOf.has(c.segment)) continue;
        seasonNames[nextSeason] = c.segment.replace(/_/g, " ");
        seasonOf.set(c.segment, nextSeason++);
      }
      const bySegment = new Map<string, ListedEpisode[]>();
      for (const c of cards) bySegment.set(c.segment, [...(bySegment.get(c.segment) ?? []), c]);
      const episodes: VodEpisode[] = [];
      for (const [segment, list] of bySegment) {
        const season = seasonOf.get(segment)!;
        const ordered = [...list].sort((a, b) => Number(a.kanId) - Number(b.kanId));
        for (const e of assignEpisodeNumbers(ordered, (x) => episodeNumberFromTitle(x.title))) {
          episodes.push({
            id: `${episodeSegmentId(segment)}-${e.kanId}`,
            season,
            episode: e.episode,
            title: e.title || `פרק ${e.episode}`,
            thumbnail: e.thumbnail,
            description: e.description,
            durationSec: e.durationSec,
          });
        }
      }
      episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);

      const pageGenres = [...text.matchAll(/<div class="info-genre[\s\S]*?<\/ul>/gi)].flatMap((m) => [...m[0].matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((li) => textOf(li[1])));
      const hero = text.match(/hero-vod-img[^>]*background-image:\s*url\(([^)]+)\)/i)?.[1];
      const logoTag = text.match(/<div class="logo hero-vod-logo">[\s\S]*?(<img\s[^>]*>)/i)?.[1];
      const description = textOf(decodeEntities(metaContent(text, "og:description") ?? "")) || listed.description;
      const { url: _url, ...base } = listed;
      return {
        ...base,
        title: base.title || textOf(metaContent(text, "og:title")),
        description,
        background: hero ? new URL(decodeEntities(hero).replace(/["']/g, ""), SITE).toString() : metaContent(text, "og:image"),
        logo: logoTag ? firstImage(logoTag, SITE) : undefined,
        genres: [...new Set([...base.genres, ...genresFor(pageGenres)])].sort(),
        episodes,
        seasonNames: Object.keys(seasonNames).length ? seasonNames : undefined,
      };
    },

    resolveEpisodeStreams: async (programId: string, episodeId: string, ctx: ProviderContext): Promise<ResolvedStream[]> => {
      const url = await this.programUrl(programId, ctx);
      const m = episodeId.match(/^([a-z0-9_]+)-(\d+)$/i);
      if (!url || !m) return [];
      const { text } = await this.get(`${url}${episodePathSegment(m[1]!)}${m[2]}/`, ctx);
      const config = parsePlayerConfig(text);
      if (!config?.file) {
        ctx.logger.warn("no Redge player config on Kan episode page", { programId, episodeId });
        return [];
      }
      if (config.drm?.widevine || config.drm?.fairplay?.src) {
        ctx.logger.warn("Kan episode is DRM-protected, skipped", { programId, episodeId });
        return [];
      }
      const out: ResolvedStream[] = [];
      const hls = https(config.file.hls);
      const dash = https(config.file.dash);
      if (hls) out.push({ url: hls, format: "hls", label: "Kan HLS", source: "kan-episode-page", geo: "israel-only" });
      if (dash) out.push({ url: dash, format: "dash", label: "Kan DASH", source: "kan-episode-page", geo: "israel-only" });
      return out;
    },
  };
}
