import type { ItemHealth, ResolvedStream } from "../domain/types.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProviderAdapter, VodEpisode, VodProgram, VodProgramDetail } from "../providers/types.js";
import type { LatestChecks, Store } from "../storage/types.js";
import type { CatalogExtra } from "../stremio/extra.js";
import { parseItemId, vodEpisodeId, vodProgramId } from "../stremio/ids.js";
import type { Manifest, Meta, MetaPreview, Stream } from "../stremio/schemas.js";
import { TtlCache } from "../util/cache.js";
import { matchesQuery } from "../util/text.js";
import { itemHealth, statusLine } from "./health.js";

export const VOD_CATALOG_PREFIX = "iltv-vod-";
export const MOVIE_CATALOG_ID = "iltv-movies";
export const VOD_PAGE_SIZE = 100;
const PROGRAM_LIST_TTL_MS = 60 * 60_000;
const PROGRAM_DETAIL_TTL_MS = 30 * 60_000;
const STREAM_TTL_MS = 5 * 60_000;
const STREAM_EXPIRY_MARGIN_MS = 60_000;
/** A failed provider call is retried after this long instead of on every request. */
const FAILURE_TTL_MS = 60_000;

/** Genres offered as catalog filters. Providers map their own categories onto these names. */
export const VOD_GENRES = [
  "Comedy",
  "Crime",
  "Culture",
  "Current Affairs",
  "Documentary",
  "Drama",
  "Entertainment",
  "Food",
  "Foreign",
  "Judaism",
  "Kids",
  "Music",
  "News",
  "Parliament",
  "Reality",
  "Science",
  "Talk",
] as const;

export interface Program extends VodProgram {
  stremioId: string;
}

export interface VodDeps {
  registry: ProviderRegistry;
  store: Store;
  streamPolicy: "verified-only" | "all-labeled";
  verifiedMaxAgeMs: number;
  now: () => number;
}

/**
 * VOD side of the add-on: provider catalogs, series/movie metadata and episode streams.
 * Program lists and details are cached per isolate; a failing provider yields an empty catalog, never an error.
 */
export class VodService {
  private readonly programLists = new TtlCache<VodProgram[]>(100);
  private readonly details = new TtlCache<VodProgramDetail | null>(500);
  private readonly streamLists = new TtlCache<ResolvedStream[]>(2000);

  constructor(private readonly deps: VodDeps) {}

  vodProviders(): ProviderAdapter[] {
    return this.deps.registry.enabled().filter((p) => p.vod);
  }

  /** Programs of one provider, or [] when it is down. */
  async programs(providerId: string): Promise<Program[]> {
    const p = this.deps.registry.get(providerId);
    if (!p?.vod) return [];
    try {
      const list = await this.programLists.getOrLoad(p.id, async () => {
        const r = await this.deps.registry.call(p, "listPrograms", (ctx) => p.vod!.listPrograms(ctx));
        return r.ok ? { value: r.value, ttlMs: PROGRAM_LIST_TTL_MS } : { value: [], ttlMs: FAILURE_TTL_MS };
      });
      return list.map((prog) => ({ ...prog, stremioId: vodProgramId(prog.provider, prog.id) }));
    } catch {
      return [];
    }
  }

  async allPrograms(): Promise<Program[]> {
    return (await Promise.all(this.vodProviders().map((p) => this.programs(p.id)))).flat();
  }

  /** Cached program list length, without triggering a load. Undefined when not loaded yet. */
  cachedProgramCount(providerId: string): number | undefined {
    return this.programLists.get(providerId)?.length;
  }

  async program(providerId: string, programId: string): Promise<VodProgramDetail | undefined> {
    const p = this.deps.registry.get(providerId);
    if (!p?.vod) return undefined;
    const key = `${providerId}:${programId}`;
    try {
      const detail = await this.details.getOrLoad(key, async () => {
        const r = await this.deps.registry.call(p, "getProgram", (ctx) => p.vod!.getProgram(programId, ctx));
        if (!r.ok) return { value: null, ttlMs: FAILURE_TTL_MS };
        return { value: r.value ?? null, ttlMs: PROGRAM_DETAIL_TTL_MS };
      });
      return detail ?? undefined;
    } catch {
      return undefined;
    }
  }

  manifestCatalogs(): Manifest["catalogs"] {
    const extra = [{ name: "genre", options: [...VOD_GENRES] }, { name: "search" }, { name: "skip" }];
    const catalogs: Manifest["catalogs"] = this.vodProviders().map((p) => ({
      type: "series",
      id: `${VOD_CATALOG_PREFIX}${p.id}`,
      name: `${p.name} VOD`,
      extra,
    }));
    if (catalogs.length) catalogs.push({ type: "movie", id: MOVIE_CATALOG_ID, name: "Israeli Movies & Documentaries", extra });
    return catalogs;
  }

  private async latestChecks(): Promise<Map<string, LatestChecks>> {
    return this.deps.store.latestChecks();
  }

  /**
   * Playback status of a provider's VOD, from the newest checks of any of its episodes.
   * The verifier decodes a sample of episodes; this is what "verified" means for an episode nobody checked.
   */
  providerHealth(providerId: string, latest: Map<string, LatestChecks>): ItemHealth {
    const prefix = `${vodProgramId(providerId, "")}`;
    let probe: LatestChecks["probe"];
    let playback: LatestChecks["playback"];
    for (const [id, c] of latest) {
      if (!id.startsWith(prefix)) continue;
      if (c.probe && (!probe || c.probe.checkedAt > probe.checkedAt)) probe = c.probe;
      if (c.playback && (!playback || c.playback.checkedAt > playback.checkedAt)) playback = c.playback;
    }
    return itemHealth({ probe, playback }, this.deps.now(), this.deps.verifiedMaxAgeMs);
  }

  private providerVisible(providerId: string, latest: Map<string, LatestChecks>): boolean {
    return this.deps.streamPolicy === "all-labeled" || this.providerHealth(providerId, latest).status === "verified";
  }

  async catalog(type: string, id: string, extra: CatalogExtra): Promise<MetaPreview[] | undefined> {
    let programs: Program[];
    if (type === "series" && id.startsWith(VOD_CATALOG_PREFIX)) {
      programs = (await this.programs(id.slice(VOD_CATALOG_PREFIX.length))).filter((p) => p.kind === "series");
    } else if (type === "movie" && id === MOVIE_CATALOG_ID) {
      programs = (await this.allPrograms()).filter((p) => p.kind === "movie");
    } else {
      return undefined;
    }
    const latest = await this.latestChecks();
    return programs
      .filter((p) => this.providerVisible(p.provider, latest))
      .filter((p) => !extra.genre || p.genres.includes(extra.genre))
      .filter((p) => !extra.search || matchesQuery(extra.search, [p.title, p.originalTitle]))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(extra.skip, extra.skip + VOD_PAGE_SIZE)
      .map((p) => ({
        id: p.stremioId,
        type: p.kind,
        name: p.title,
        poster: p.poster,
        posterShape: p.posterShape ?? "poster",
        description: p.description,
        genres: p.genres,
      }));
  }

  async meta(type: string, id: string): Promise<Meta | undefined> {
    const parsed = parseItemId(id);
    if (parsed?.kind !== "vod" || parsed.episodeId || (type !== "series" && type !== "movie")) return undefined;
    const latest = await this.latestChecks();
    if (!this.providerVisible(parsed.provider, latest)) return undefined;
    const d = await this.program(parsed.provider, parsed.programId);
    if (!d || d.kind !== type) return undefined;
    const provider = this.deps.registry.get(d.provider);
    const notes = [vodStatusLine(this.providerHealth(d.provider, latest), this.deps.now(), provider?.name ?? d.provider)];
    if (d.geo === "israel-only") notes.push("🇮🇱 Plays only in Israel");
    const meta: Meta = {
      id,
      type: d.kind,
      name: d.title,
      poster: d.poster,
      posterShape: d.posterShape ?? "poster",
      background: d.background,
      logo: d.logo,
      description: [d.description, ...notes].filter(Boolean).join("\n\n"),
      genres: d.genres,
      language: d.language,
      website: d.website,
      releaseInfo: d.year ? String(d.year) : undefined,
    };
    if (d.kind === "series") meta.videos = d.episodes.map((e) => toVideo(d, e));
    return meta;
  }

  /** Resolves fresh playback URLs for one episode. Cached until shortly before any token expires. */
  async resolve(providerId: string, programId: string, episodeId: string): Promise<ResolvedStream[]> {
    const p = this.deps.registry.get(providerId);
    if (!p?.vod) return [];
    try {
      return await this.streamLists.getOrLoad(vodEpisodeId(providerId, programId, episodeId), async () => {
        const r = await this.deps.registry.call(p, "resolveEpisodeStreams", (ctx) => p.vod!.resolveEpisodeStreams(programId, episodeId, ctx));
        if (!r.ok) throw new Error(r.error);
        const now = this.deps.now();
        const ttls = r.value.map((s) => (s.expiresAt ? s.expiresAt - now - STREAM_EXPIRY_MARGIN_MS : STREAM_TTL_MS));
        return { value: r.value.filter((s) => !s.expiresAt || s.expiresAt > now), ttlMs: Math.min(STREAM_TTL_MS, ...ttls) };
      });
    } catch {
      return [];
    }
  }

  /** Finds the episode a stream request is for. Movies are requested by program id and play their only episode. */
  async episodeFor(type: string, id: string): Promise<{ program: VodProgramDetail; episode: VodEpisode } | undefined> {
    const parsed = parseItemId(id);
    if (parsed?.kind !== "vod") return undefined;
    if (type === "series" && !parsed.episodeId) return undefined;
    if (type !== "series" && type !== "movie") return undefined;
    const program = await this.program(parsed.provider, parsed.programId);
    if (!program) return undefined;
    const episode = parsed.episodeId ? program.episodes.find((e) => e.id === parsed.episodeId) : program.episodes[0];
    return episode ? { program, episode } : undefined;
  }

  async streams(type: string, id: string): Promise<Stream[] | undefined> {
    if (parseItemId(id)?.kind !== "vod") return undefined;
    const found = await this.episodeFor(type, id);
    if (!found) return [];
    const { program, episode } = found;
    const episodeStremioId = vodEpisodeId(program.provider, program.id, episode.id);
    const latest = await this.latestChecks();
    const own = latest.get(episodeStremioId);
    const ownHealth = own ? itemHealth(own, this.deps.now(), this.deps.verifiedMaxAgeMs) : undefined;
    const providerHealth = this.providerHealth(program.provider, latest);
    const visible =
      this.deps.streamPolicy === "all-labeled" ||
      ownHealth?.status === "verified" ||
      (providerHealth.status === "verified" && ownHealth?.status !== "failing");
    if (!visible) return [];

    const providerName = this.deps.registry.get(program.provider)?.name ?? program.provider;
    const status = ownHealth && ownHealth.status !== "unverified" ? statusLine(ownHealth, this.deps.now()) : vodStatusLine(providerHealth, this.deps.now(), providerName);
    const resolved = await this.resolve(program.provider, program.id, episode.id);
    const label = program.kind === "series" ? `S${episode.season}E${episode.episode}` : program.title;
    return resolved.map((s): Stream => {
      if (s.format === "external") {
        // Not a stream: the broadcaster's own page, for content we cannot play inside Stremio.
        const text = [`${program.title} · ${label}`, `🔗 Opens ${s.label ?? "the broadcaster's site"} in the browser; not playable in Stremio`];
        if (s.geo === "israel-only") text.push("🇮🇱 Plays only in Israel");
        return { externalUrl: s.url, name: `Israeli TV\n${s.label ?? providerName}`, title: text.join("\n"), description: text.join("\n") };
      }
      const lines = [`${program.title} · ${label} · ${s.format.toUpperCase()}`, status];
      if (s.geo === "israel-only") lines.push("🇮🇱 Plays only in Israel");
      const text = lines.join("\n");
      return {
        url: s.url,
        name: `Israeli TV\n${s.label ?? providerName}`,
        title: text,
        description: text,
        behaviorHints: {
          bingeGroup: `iltv-${program.provider}-${program.id}-${s.label ?? "vod"}`,
          ...(s.headers && Object.keys(s.headers).length ? { notWebReady: true, proxyHeaders: { request: s.headers } } : {}),
        },
      };
    });
  }
}

/** Status shown on an episode nobody checked individually: the provider's sample verification. */
export function vodStatusLine(h: ItemHealth, now: number, providerName: string): string {
  if (h.status === "verified") return `${statusLine(h, now)} (sample of ${providerName} episodes)`;
  if (h.status === "failing") return `${statusLine(h, now)} (sample of ${providerName} episodes)`;
  return "⚠️ Not verified yet";
}

function toVideo(program: VodProgramDetail, e: VodEpisode): NonNullable<Meta["videos"]>[number] {
  return {
    id: vodEpisodeId(program.provider, program.id, e.id),
    title: e.title,
    season: e.season,
    episode: e.episode,
    released: e.released,
    thumbnail: e.thumbnail,
    overview: e.description,
  };
}
