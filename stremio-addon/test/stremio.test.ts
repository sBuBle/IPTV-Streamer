import { describe, expect, it } from "vitest";
import { buildAddon } from "../src/bootstrap.js";
import type { Env } from "../src/config.js";
import { silentLogger } from "../src/logger.js";
import { MemoryStore } from "../src/storage/memory.js";
import { catalogResponseSchema, manifestSchema, metaResponseSchema, streamResponseSchema } from "../src/stremio/schemas.js";
import { channel, staticProvider, testConfig } from "./helpers.js";

const TOKEN = "test-admin-token-123456";
const NOW = 1_800_000_000_000;

function setup(env: Env = {}) {
  const store = new MemoryStore();
  const news = staticProvider(
    "news",
    [
      channel({ id: "news-1", provider: "news", name: "Knesset Channel", nameHe: "ערוץ הכנסת", genres: ["News", "Parliament"] }),
      channel({ id: "news-2", provider: "news", name: "Kan 11", nameHe: "כאן 11", geo: "israel-only" }),
    ],
    {
      "news-1": [{ url: "https://cdn.example.com/k/master.m3u8", format: "hls", label: "Auto", source: "test", geo: "unknown" }],
      "news-2": [{ url: "https://cdn.example.com/kan/master.m3u8", format: "hls", label: "Auto", source: "test", geo: "israel-only", headers: { Referer: "https://www.kan.org.il/" } }],
    },
  );
  const down = staticProvider("down", [], {}, { fail: true });
  const addon = buildAddon({
    config: testConfig({ BASE_URL: "https://tv.example.com", ADMIN_TOKEN: TOKEN, ...env }),
    logger: silentLogger,
    store,
    providers: [news, down],
    now: () => NOW,
  });
  return { ...addon, store };
}

const get = async (app: ReturnType<typeof setup>["app"], path: string) => {
  const res = await app.request(path);
  return { res, body: (await res.json()) as any };
};

describe("Stremio protocol", () => {
  it("serves a valid manifest with CORS", async () => {
    const { app } = setup();
    const { res, body } = await get(app, "/manifest.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const m = manifestSchema.parse(body);
    expect(m.catalogs).toEqual([
      { type: "tv", id: "iltv-live", name: "Israeli Live TV", extra: [{ name: "genre", options: ["News", "Parliament"] }, { name: "search" }, { name: "skip" }] },
    ]);
    expect(m.idPrefixes).toEqual(["iltv:"]);
  });

  it("lists channels even when another provider is down", async () => {
    const { app, registry } = setup();
    const { body } = await get(app, "/catalog/tv/iltv-live.json");
    const { metas } = catalogResponseSchema.parse(body);
    expect(metas.map((m) => m.id)).toEqual(["iltv:live:news:news-1", "iltv:live:news:news-2"]);
    expect(metas[0]!.poster).toBe("https://tv.example.com/assets/poster/iltv%3Alive%3Anews%3Anews-1.svg");
    expect(metas[1]!.description).toContain("Plays only in Israel");
    expect(registry.healthReport().find((p) => p.id === "down")?.lastError).toMatch(/down is down/);
  });

  it("supports Hebrew search, genre and skip extras", async () => {
    const { app } = setup();
    const search = await get(app, `/catalog/tv/iltv-live/search=${encodeURIComponent("כנסת")}.json`);
    expect(search.body.metas.map((m: any) => m.name)).toEqual(["Knesset Channel"]);
    const genre = await get(app, "/catalog/tv/iltv-live/genre=Parliament.json");
    expect(genre.body.metas).toHaveLength(1);
    const skip = await get(app, "/catalog/tv/iltv-live/skip=100.json");
    expect(skip.body.metas).toEqual([]);
    const other = await get(app, "/catalog/movie/iltv-live.json");
    expect(other.body.metas).toEqual([]);
  });

  it("serves meta and streams with labels and proxy headers", async () => {
    const { app } = setup();
    const meta = await get(app, "/meta/tv/iltv:live:news:news-1.json");
    expect(metaResponseSchema.parse(meta.body).meta).toMatchObject({ name: "Knesset Channel", type: "tv" });
    expect(meta.body.meta.description).toContain("Not verified yet");

    const s1 = streamResponseSchema.parse((await get(app, "/stream/tv/iltv:live:news:news-1.json")).body);
    expect(s1.streams[0]).toMatchObject({ url: "https://cdn.example.com/k/master.m3u8" });
    expect(s1.streams[0]!.behaviorHints?.notWebReady).toBeUndefined();

    const s2 = (await get(app, "/stream/tv/iltv:live:news:news-2.json")).body;
    expect(s2.streams[0].behaviorHints).toMatchObject({ notWebReady: true, proxyHeaders: { request: { Referer: "https://www.kan.org.il/" } } });
    expect(s2.streams[0].description).toContain("Plays only in Israel");
  });

  it("returns 404 / empty for unknown ids", async () => {
    const { app } = setup();
    expect((await app.request("/meta/tv/iltv:live:news:nope.json")).status).toBe(404);
    expect((await get(app, "/stream/tv/tt1234567.json")).body).toEqual({ streams: [] });
  });

  it("in verified-only mode hides everything until a playback check passes", async () => {
    const { app } = setup({ STREAM_POLICY: "verified-only" });
    expect((await get(app, "/catalog/tv/iltv-live.json")).body.metas).toEqual([]);
    expect((await get(app, "/stream/tv/iltv:live:news:news-1.json")).body.streams).toEqual([]);

    const push = await app.request("/admin/checks", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify([{ itemId: "iltv:live:news:news-1", provider: "news", kind: "probe", ok: true, checkedAt: NOW - 1000 }]),
    });
    expect(push.status).toBe(200);
    // A passing probe is not enough.
    expect((await get(app, "/catalog/tv/iltv-live.json")).body.metas).toEqual([]);

    await app.request("/admin/checks", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify([{ itemId: "iltv:live:news:news-1", provider: "news", kind: "playback", ok: true, checkedAt: NOW - 1000, location: "IL" }]),
    });
    const metas = (await get(app, "/catalog/tv/iltv-live.json")).body.metas;
    expect(metas.map((m: any) => m.id)).toEqual(["iltv:live:news:news-1"]);
    expect(metas[0].description).toContain("Playback verified 1 min ago from IL");
    expect((await get(app, "/stream/tv/iltv:live:news:news-1.json")).body.streams).toHaveLength(1);
  });

  it("protects admin routes", async () => {
    const { app } = setup();
    const res = await app.request("/admin/checks", { method: "POST", headers: { authorization: "Bearer wrong" }, body: "[]" });
    expect(res.status).toBe(401);
    const bad = await app.request("/admin/checks", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: '[{"itemId":"x"}]' });
    expect(bad.status).toBe(400);
    const { app: noAdmin } = setup({ ADMIN_TOKEN: "" });
    expect((await noAdmin.request("/admin/checks", { method: "POST", body: "[]" })).status).toBe(404);
  });

  it("reports coverage without counting unverified channels as working", async () => {
    const { app } = setup();
    const { body } = await get(app, "/coverage");
    expect(body.providers.find((p: any) => p.provider === "news")).toMatchObject({
      liveChannelsDiscovered: 2,
      liveChannelsVerified: 0,
      liveChannelsUnchecked: 2,
      verifiedPlayableCoveragePct: 0,
    });
  });

  it("serves a name poster and the install page", async () => {
    const { app } = setup();
    const svg = await app.request("/assets/poster/iltv%3Alive%3Anews%3Anews-1.svg");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(await svg.text()).toContain("Knesset");
    const home = await (await app.request("/")).text();
    expect(home).toContain("stremio://tv.example.com/manifest.json");
  });
});
