import { describe, expect, it } from "vitest";
import { buildAddon } from "../src/bootstrap.js";
import type { Env } from "../src/config.js";
import type { ResolvedStream } from "../src/domain/types.js";
import { silentLogger } from "../src/logger.js";
import type { ProviderAdapter, VodProgramDetail } from "../src/providers/types.js";
import { MemoryStore } from "../src/storage/memory.js";
import { parseItemId, vodEpisodeId, vodProgramId } from "../src/stremio/ids.js";
import { catalogResponseSchema, manifestSchema, metaResponseSchema, streamResponseSchema } from "../src/stremio/schemas.js";
import { testConfig } from "./helpers.js";

const TOKEN = "test-admin-token-123456";
const NOW = 1_800_000_000_000;

const SHOW: VodProgramDetail = {
  id: "show-1",
  provider: "tvco",
  kind: "series",
  title: "הכוורת",
  originalTitle: "The Hive",
  poster: "https://img.example/hive.jpg",
  genres: ["Entertainment"],
  language: "he",
  geo: "israel-only",
  updatedAt: NOW - 1000,
  episodes: [
    { id: "1-100", season: 1, episode: 1, title: "פרק 1", released: "2026-10-01T00:00:00.000Z" },
    { id: "1-101", season: 1, episode: 2, title: "פרק 2" },
  ],
};

const FILM: VodProgramDetail = {
  id: "film-1",
  provider: "tvco",
  kind: "movie",
  title: "Doc Film",
  genres: ["Documentary"],
  language: "he",
  geo: "unknown",
  episodes: [{ id: "0-500", season: 1, episode: 1, title: "Doc Film" }],
};

function vodProvider(id: string, programs: VodProgramDetail[], streams: Record<string, ResolvedStream[]>, opts: { fail?: boolean } = {}): ProviderAdapter {
  return {
    id,
    name: `Provider ${id}`,
    issues: () => [],
    vod: {
      listPrograms: async () => {
        if (opts.fail) throw new Error(`${id} is down`);
        return programs.map(({ episodes: _e, ...p }) => p);
      },
      getProgram: async (programId) => programs.find((p) => p.id === programId),
      resolveEpisodeStreams: async (programId, episodeId) => streams[`${programId}/${episodeId}`] ?? [],
    },
  };
}

function setup(env: Env = {}, extra: ProviderAdapter[] = []) {
  const store = new MemoryStore();
  const tvco = vodProvider("tvco", [SHOW, FILM], {
    "show-1/1-101": [{ url: "https://cdn.example/hive/2.m3u8", format: "hls", label: "HLS", source: "test", geo: "israel-only" }],
    "film-1/0-500": [{ url: "https://cdn.example/film.m3u8", format: "hls", label: "HLS", source: "test", geo: "unknown" }],
  });
  const addon = buildAddon({
    config: testConfig({ BASE_URL: "https://tv.example.com", ADMIN_TOKEN: TOKEN, ...env }),
    logger: silentLogger,
    store,
    providers: [tvco, vodProvider("down", [], {}, { fail: true }), ...extra],
    now: () => NOW,
  });
  return { ...addon, store };
}

const get = async (app: ReturnType<typeof setup>["app"], path: string) => {
  const res = await app.request(path);
  return { res, body: (await res.json()) as any };
};

describe("VOD ids", () => {
  it("round-trips program and episode ids", () => {
    expect(parseItemId(vodProgramId("kan", "12832"))).toEqual({ kind: "vod", provider: "kan", programId: "12832" });
    expect(parseItemId(vodEpisodeId("kan", "12832", "6-1098375"))).toEqual({ kind: "vod", provider: "kan", programId: "12832", episodeId: "6-1098375" });
    expect(parseItemId("iltv:live:knesset:knesset-99")).toEqual({ kind: "live", provider: "knesset", channelId: "knesset-99" });
    expect(parseItemId("iltv:vod:kan:a/b")).toBeUndefined();
    expect(parseItemId("tt0111161")).toBeUndefined();
  });
});

describe("VOD in Stremio", () => {
  it("adds series and movie catalogs to the manifest", async () => {
    const { app } = setup();
    const m = manifestSchema.parse((await get(app, "/manifest.json")).body);
    expect(m.types).toEqual(["tv", "series", "movie"]);
    expect(m.catalogs.map((c) => `${c.type}/${c.id}`)).toEqual(["series/iltv-vod-tvco", "series/iltv-vod-down", "movie/iltv-movies"]);
  });

  it("lists series per provider and movies across providers, with search and genre", async () => {
    const { app } = setup();
    const series = catalogResponseSchema.parse((await get(app, "/catalog/series/iltv-vod-tvco.json")).body);
    expect(series.metas.map((x) => x.id)).toEqual(["iltv:vod:tvco:show-1"]);
    const movies = catalogResponseSchema.parse((await get(app, "/catalog/movie/iltv-movies.json")).body);
    expect(movies.metas.map((x) => x.id)).toEqual(["iltv:vod:tvco:film-1"]);
    expect((await get(app, `/catalog/series/iltv-vod-tvco/search=${encodeURIComponent("כוורת")}.json`)).body.metas).toHaveLength(1);
    expect((await get(app, "/catalog/series/iltv-vod-tvco/search=hive.json")).body.metas).toHaveLength(1);
    expect((await get(app, "/catalog/series/iltv-vod-tvco/genre=Drama.json")).body.metas).toEqual([]);
    // A provider that is down gives an empty catalog, not an error.
    expect((await get(app, "/catalog/series/iltv-vod-down.json")).body.metas).toEqual([]);
  });

  it("serves series meta with seasons and episodes", async () => {
    const { app } = setup();
    const { meta } = metaResponseSchema.parse((await get(app, "/meta/series/iltv:vod:tvco:show-1.json")).body);
    expect(meta.videos?.map((v) => [v.id, v.season, v.episode])).toEqual([
      ["iltv:vod:tvco:show-1:1-100", 1, 1],
      ["iltv:vod:tvco:show-1:1-101", 1, 2],
    ]);
    expect(meta.description).toContain("Plays only in Israel");
    expect((await app.request("/meta/movie/iltv:vod:tvco:show-1.json")).status).toBe(404);
  });

  it("resolves episode streams with honest labels, and movies by program id", async () => {
    const { app } = setup();
    const ep = streamResponseSchema.parse((await get(app, "/stream/series/iltv:vod:tvco:show-1:1-101.json")).body);
    expect(ep.streams[0]).toMatchObject({ url: "https://cdn.example/hive/2.m3u8" });
    expect(ep.streams[0]!.title).toContain("S1E2");
    expect(ep.streams[0]!.title).toContain("Not verified yet");
    expect(ep.streams[0]!.title).toContain("Plays only in Israel");
    expect((await get(app, "/stream/series/iltv:vod:tvco:show-1:1-100.json")).body.streams).toEqual([]);
    expect((await get(app, "/stream/series/iltv:vod:tvco:show-1:9-999.json")).body.streams).toEqual([]);
    const film = streamResponseSchema.parse((await get(app, "/stream/movie/iltv:vod:tvco:film-1.json")).body);
    expect(film.streams[0]!.url).toBe("https://cdn.example/film.m3u8");
  });

  it("turns external links into externalUrl entries that never pose as streams", async () => {
    const ext = vodProvider("ext", [{ ...SHOW, provider: "ext" }], {
      "show-1/1-100": [{ url: "https://broadcaster.example/ep1.htm", format: "external", label: "broadcaster.example", source: "test", geo: "israel-only" }],
    });
    const { app } = setup({}, [ext]);
    const s = streamResponseSchema.parse((await get(app, "/stream/series/iltv:vod:ext:show-1:1-100.json")).body).streams[0]!;
    expect(s.url).toBeUndefined();
    expect(s.externalUrl).toBe("https://broadcaster.example/ep1.htm");
    expect(s.title).toContain("not playable in Stremio");
  });

  it("in verified-only mode shows a provider's VOD once a sample episode decoded", async () => {
    const { app } = setup({ STREAM_POLICY: "verified-only" });
    expect((await get(app, "/catalog/series/iltv-vod-tvco.json")).body.metas).toEqual([]);
    expect((await get(app, "/stream/series/iltv:vod:tvco:show-1:1-101.json")).body.streams).toEqual([]);

    await app.request("/admin/checks", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify([{ itemId: "iltv:vod:tvco:show-1:1-100", provider: "tvco", kind: "playback", ok: true, checkedAt: NOW - 1000, location: "IL" }]),
    });
    expect((await get(app, "/catalog/series/iltv-vod-tvco.json")).body.metas).toHaveLength(1);
    const s = (await get(app, "/stream/series/iltv:vod:tvco:show-1:1-101.json")).body.streams;
    expect(s).toHaveLength(1);
    expect(s[0].title).toContain("Playback verified 1 min ago from IL (sample of Provider tvco episodes)");

    const coverage = (await get(app, "/coverage")).body.providers.find((p: any) => p.provider === "tvco");
    expect(coverage).toMatchObject({ vodProgramsDiscovered: 2, vodSeriesDiscovered: 1, vodMoviesDiscovered: 1, vodEpisodesChecked: 1, vodEpisodesVerified: 1, vodSampleStatus: "verified" });
  });
});
