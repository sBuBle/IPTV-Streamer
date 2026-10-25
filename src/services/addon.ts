import type { Config } from "../config.js";
import type { ItemHealth, LiveChannel, ResolvedStream, StreamCheck } from "../domain/types.js";
import type { Logger } from "../logger.js";
import { probeHls } from "../media/probe.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { Store } from "../storage/types.js";
import type { CatalogExtra } from "../stremio/extra.js";
import { ID_PREFIX, liveItemId, parseItemId } from "../stremio/ids.js";
import type { Manifest, Meta, MetaPreview, Stream } from "../stremio/schemas.js";
import { TtlCache } from "../util/cache.js";
import { redactUrl, type FetchFn } from "../util/http.js";
import { matchesQuery } from "../util/text.js";
import { itemHealth, statusLine } from "./health.js";
import { VodService } from "./vod.js";

export const LIVE_CATALOG_ID = "iltv-live";
export const PAGE_SIZE = 100;
const CHANNEL_LIST_TTL_MS = 10 * 60_000;
const STREAM_TTL_MS = 5 * 60_000;
const STREAM_EXPIRY_MARGIN_MS = 60_000;

export interface Channel extends LiveChannel {
  stremioId: string;
}

export interface AddonDeps {
  config: Config;
  logger: Logger;
  registry: ProviderRegistry;
  store: Store;
  fetch?: FetchFn;
  now?: () => number;
  version?: string;
}

export class AddonService {
  private readonly channelLists = new TtlCache<LiveChannel[]>(100);
  private readonly streamLists = new TtlCache<ResolvedStream[]>(1000);
  private readonly now: () => number;
  readonly vod: VodService;

  constructor(private readonly deps: AddonDeps) {
    this.now = deps.now ?? Date.now;
    this.vod = new VodService({
      registry: deps.registry,
      store: deps.store,
      streamPolicy: deps.config.streamPolicy,
      verifiedMaxAgeMs: deps.config.verifiedMaxAgeMs,
      now: this.now,
    });
  }

  private liveProviders(): ProviderAdapter[] {
    return this.deps.registry.enabled().filter((p) => p.live);
  }

  /** Channels from every live provider. A provider that fails is left out and reported in diagnostics. */
  async channels(): Promise<Channel[]> {
    const lists = await Promise.all(
      this.liveProviders().map(async (p) => {
        try {
          return await this.channelLists.getOrLoad(p.id, async () => {
            const r = await this.deps.registry.call(p, "listChannels", (ctx) => p.live!.listChannels(ctx));
            if (!r.ok) throw new Error(r.error);
            return { value: r.value, ttlMs: CHANNEL_LIST_TTL_MS };
          });
        } catch {
          return [];
        }
      }),
    );
    return lists.flat().map((c) => ({ ...c, stremioId: liveItemId(c.provider, c.id) }));
  }

  async channel(stremioId: string): Promise<Channel | undefined> {
    const parsed = parseItemId(stremioId);
    if (parsed?.kind !== "live") return undefined;
    return (await this.channels()).find((c) => c.provider === parsed.provider && c.id === parsed.channelId);
  }

  async healthByItem(): Promise<Map<string, ItemHealth>> {
    const latest = await this.deps.store.latestChecks();
    const now = this.now();
    const out = new Map<string, ItemHealth>();
    for (const c of await this.channels()) out.set(c.stremioId, itemHealth(latest.get(c.stremioId), now, this.deps.config.verifiedMaxAgeMs));
    return out;
  }

  private visible(h: ItemHealth | undefined): boolean {
    return this.deps.config.streamPolicy === "all-labeled" || h?.status === "verified";
  }

  async manifest(): Promise<Manifest> {
    const channels = await this.channels();
    const genres = [...new Set(channels.flatMap((c) => c.genres))].sort();
    const catalogs: Manifest["catalogs"] = [];
    if (this.liveProviders().length > 0) {
      catalogs.push({
        type: "tv",
        id: LIVE_CATALOG_ID,
        name: "Israeli Live TV",
        extra: [{ name: "genre", options: genres }, { name: "search" }, { name: "skip" }],
      });
    }
    catalogs.push(...this.vod.manifestCatalogs());
    const types = ["tv", ...(this.vod.vodProviders().length ? ["series", "movie"] : [])];
    return {
      id: "community.israeli-tv",
      version: this.deps.version ?? "0.1.0",
      name: "Israeli TV",
      description:
        "Israeli live TV and VOD from broadcaster sources. Streams come straight from each broadcaster; Israel-only streams are labeled and only play inside Israel.",
      resources: ["catalog", "meta", "stream"],
      types,
      idPrefixes: [ID_PREFIX],
      catalogs,
      behaviorHints: { configurable: false, adult: false, p2p: false },
    };
  }

  async catalog(type: string, id: string, extra: CatalogExtra, baseUrl: string): Promise<MetaPreview[]> {
    if (type !== "tv") return (await this.vod.catalog(type, id, extra)) ?? [];
    if (id !== LIVE_CATALOG_ID) return [];
    const [channels, health] = await Promise.all([this.channels(), this.healthByItem()]);
    const now = this.now();
    return channels
      .filter((c) => this.visible(health.get(c.stremioId)))
      .filter((c) => !extra.genre || c.genres.includes(extra.genre))
      .filter((c) => !extra.search || matchesQuery(extra.search, [c.name, c.nameHe, ...(c.aliases ?? [])]))
      .slice(extra.skip, extra.skip + PAGE_SIZE)
      .map((c) => ({
        id: c.stremioId,
        type: "tv",
        name: c.name,
        poster: c.logo ?? posterUrl(baseUrl, c.stremioId),
        posterShape: "square" as const,
        description: describeChannel(c, health.get(c.stremioId), now),
        genres: c.genres,
      }));
  }

  async meta(type: string, id: string, baseUrl: string): Promise<Meta | undefined> {
    if (type !== "tv") return this.vod.meta(type, id);
    const c = await this.channel(id);
    if (!c) return undefined;
    const h = (await this.healthByItem()).get(c.stremioId);
    if (!this.visible(h)) return undefined;
    return {
      id: c.stremioId,
      type: "tv",
      name: c.name,
      poster: c.logo ?? posterUrl(baseUrl, c.stremioId),
      posterShape: "square",
      logo: c.logo,
      description: describeChannel(c, h, this.now()),
      genres: c.genres,
      language: c.language,
      website: c.website,
    };
  }

  /** Resolves fresh playback URLs for a channel. Cached until shortly before any token expires. */
  async resolve(c: Channel): Promise<ResolvedStream[]> {
    const p = this.deps.registry.get(c.provider);
    if (!p?.live) return [];
    try {
      return await this.streamLists.getOrLoad(c.stremioId, async () => {
        const r = await this.deps.registry.call(p, "resolveStreams", (ctx) => p.live!.resolveStreams(c.id, ctx));
        if (!r.ok) throw new Error(r.error);
        const now = this.now();
        const ttls = r.value.map((s) => (s.expiresAt ? s.expiresAt - now - STREAM_EXPIRY_MARGIN_MS : STREAM_TTL_MS));
        return { value: r.value.filter((s) => !s.expiresAt || s.expiresAt > now), ttlMs: Math.min(STREAM_TTL_MS, ...ttls) };
      });
    } catch {
      return [];
    }
  }

  async streams(type: string, id: string): Promise<Stream[]> {
    if (type !== "tv") return (await this.vod.streams(type, id)) ?? [];
    const c = await this.channel(id);
    if (!c) return [];
    const h = (await this.healthByItem()).get(c.stremioId);
    if (!this.visible(h)) return [];
    const resolved = await this.resolve(c);
    const now = this.now();
    return resolved.map((s) => {
      const lines = [`${c.name} · ${s.format.toUpperCase()}`, h ? statusLine(h, now) : "⚠️ Not verified yet"];
      if (s.geo === "israel-only") lines.push("🇮🇱 Plays only in Israel");
      const text = lines.join("\n");
      return {
        url: s.url,
        name: `Israeli TV\n${s.label ?? "Live"}`,
        title: text,
        description: text,
        behaviorHints: {
          bingeGroup: `iltv-${c.provider}-${s.label ?? "live"}`,
          ...(s.headers && Object.keys(s.headers).length ? { notWebReady: true, proxyHeaders: { request: s.headers } } : {}),
        },
      };
    });
  }

  /**
   * Health monitor pass: resolves and probes every channel and records "probe" checks.
   * Probes never mark anything verified; see verify/playback.ts for that.
   */
  async probeAll(location?: string): Promise<StreamCheck[]> {
    const checks: StreamCheck[] = [];
    for (const c of await this.channels()) {
      this.streamLists.delete(c.stremioId);
      const streams = await this.resolve(c);
      const first = streams[0];
      const check: StreamCheck = {
        itemId: c.stremioId,
        provider: c.provider,
        kind: "probe",
        ok: false,
        checkedAt: this.now(),
        location,
        detail: {},
      };
      if (!first) {
        check.error = "no stream resolved";
      } else {
        const r = await probeHls(first, { timeoutMs: this.deps.config.requestTimeoutMs, fetch: this.deps.fetch });
        check.ok = r.ok;
        check.error = r.error;
        check.streamHost = safeHost(first.url);
        check.detail = { ...r, url: redactUrl(first.url), source: first.source };
      }
      await this.deps.store.recordCheck(check);
      this.deps.logger.info("probe", { item: c.stremioId, ok: check.ok, error: check.error });
      checks.push(check);
    }
    return checks;
  }
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function describeChannel(c: Channel, h: ItemHealth | undefined, now: number): string {
  const parts = [c.nameHe && c.nameHe !== c.name ? `${c.nameHe}\n${c.description}` : c.description];
  parts.push(h ? statusLine(h, now) : "⚠️ Not verified yet");
  if (c.geo === "israel-only") parts.push("🇮🇱 Plays only in Israel");
  return parts.join("\n\n");
}

export function posterUrl(baseUrl: string, stremioId: string): string {
  return `${baseUrl}/assets/poster/${encodeURIComponent(stremioId)}.svg`;
}
