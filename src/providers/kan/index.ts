import type { Config } from "../../config.js";
import type { ResolvedStream } from "../../domain/types.js";
import { anchors, attr, decodeEntities, firstImage, metaContent, textOf } from "../../util/html.js";
import { getText } from "../../util/http.js";
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

interface ListedProgram extends VodProgram {
  url: string;
}

/**
 * Program cards on a Kan lobby page. Each card sits under a section heading (Drama, Comedy, Documentary films...),
 * which gives the genres and tells films from series.
 */
export function parseLobby(html: string): ListedProgram[] {
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
    const id = a.href.match(PROGRAM_HREF)![2]!;
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
    const film = labels.some((l) => /סרט/.test(l)) && !labels.some((l) => /סדר/.test(l));
    return { ...p, kind: film ? "movie" : "series", genres: genresFor(labels) };
  });
}

interface ListedEpisode {
  season: number;
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

/** Episode cards of one program found in a page fragment. Unseasoned links get season 0. */
export function parseEpisodeCards(html: string, programId: string, onlySeason?: number): ListedEpisode[] {
  const re = new RegExp(`/p-${programId}/(?:s(\\d+)/)?(\\d+)/$`);
  const out: ListedEpisode[] = [];
  const seen = new Set<string>();
  for (const a of anchors(html, re)) {
    const m = a.href.match(re)!;
    const season = m[1] ? Number(m[1]) : 0;
    const kanId = m[2]!;
    if ((onlySeason !== undefined && season !== onlySeason) || seen.has(kanId)) continue;
    const title = (textOf(a.inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]) || attr(a.tag, "aria-label") || "").trim();
    if (!title || !/<img\s/i.test(a.inner)) continue; // the hero "watch" button is not an episode card
    seen.add(kanId);
    out.push({
      season,
      kanId,
      title,
      thumbnail: firstImage(a.inner, SITE)?.replace(/([?&])width=\d+&(amp;)?height=\d+/, "$1width=960&height=540"),
      description: episodeSubtitle(textOf(a.inner.match(/<p[^>]*class="[^"]*cr-subtitle[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1])),
      durationSec: parseClock(textOf(a.inner.match(/<span[^>]*class="[^"]*duration[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1])),
    });
  }
  return out;
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

  constructor(private readonly cfg: Config["providers"]["kan"]) {}

  issues(): ProviderIssue[] {
    return this.cfg.lobbies.length ? [] : [{ severity: "error", message: "KAN_LOBBIES is empty" }];
  }

  private get(url: string, ctx: ProviderContext) {
    return getText(url, { timeoutMs: ctx.config.requestTimeoutMs, fetch: ctx.fetch, signal: ctx.signal, retries: 1 });
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
        for (const p of parseLobby(r.value.text)) {
          const prev = out.get(p.id);
          if (!prev) out.set(p.id, p);
          else prev.genres = [...new Set([...prev.genres, ...p.genres])].sort();
        }
      });
      if (pages.every((p) => p.status === "rejected")) throw new Error("all Kan lobbies failed");
      this.programs = out;
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
      }
      // Unseasoned links are extras next to real seasons; they are the episodes only when nothing else exists.
      if (cards.some((c) => c.season > 0)) cards = cards.filter((c) => c.season > 0);

      const bySeason = new Map<number, ListedEpisode[]>();
      for (const c of cards) bySeason.set(c.season, [...(bySeason.get(c.season) ?? []), c]);
      const episodes: VodEpisode[] = [];
      for (const [season, list] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
        const ordered = [...list].sort((a, b) => Number(a.kanId) - Number(b.kanId));
        for (const e of assignEpisodeNumbers(ordered, (x) => episodeNumberFromTitle(x.title))) {
          episodes.push({
            id: `${season}-${e.kanId}`,
            season: season || 1,
            episode: e.episode,
            title: e.title,
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
      };
    },

    resolveEpisodeStreams: async (programId: string, episodeId: string, ctx: ProviderContext): Promise<ResolvedStream[]> => {
      const url = await this.programUrl(programId, ctx);
      const m = episodeId.match(/^(\d+)-(\d+)$/);
      if (!url || !m) return [];
      const season = Number(m[1]);
      const { text } = await this.get(`${url}${season ? `s${season}/` : ""}${m[2]}/`, ctx);
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
