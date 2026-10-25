import { describe, expect, it } from "vitest";
import { silentLogger } from "../src/logger.js";
import { FALLBACK_CHANNELS, I24NewsAdapter, feedLanguage } from "../src/providers/i24news/index.js";
import { extractChannels } from "../src/providers/i24news/insight.js";
import { fakeFetch, testConfig } from "./helpers.js";

const API = "https://insight-api-shared.univtec.com/interface/pages/";

// Trimmed shape of a real Insight API page response (24 Oct 2026).
const page = (items: unknown[]) => ({
  _id: "p",
  sections: [
    { title: "Live", component: "MainHeroSlider", items },
    { title: "Shows", items: [{ id: "vod1", type: "vod", title: "A show", videoUrl: "https://vod.example.com/a.m3u8" }] },
  ],
});
const en = { id: "687cb5e702849489dbfed06f", type: "channel", title: "I24NEWS English", videoUrl: "https://i24newsenglish-cdn.encoders.immergo.tv/master.m3u8", image: "https://img/en.png", epgObject: { input: "https://epg.i24news.tv/xmlTV_EN.xml" } };
const he = { id: "69b17e029abd89c807678067", type: "channel", title: "i24NEWS Hebrew", videoUrl: "https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8", image: null };
const fr = { id: "687cb60702849489dbfed071", type: "channel", title: "I24NEWS Francais", videoUrl: "https://i24newsfrench-cdn.encoders.immergo.tv/master.m3u8" };

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const config = testConfig();
  const f = fakeFetch(routes);
  return { f, a: new I24NewsAdapter(config.providers.i24news), ctx: { fetch: f.fetch, logger: silentLogger, config, signal: new AbortController().signal } };
}

describe("i24NEWS adapter", () => {
  it("extracts only live channel items from a page", () => {
    expect(extractChannels(page([en, he])).map((c) => c.id)).toEqual([en.id, he.id]);
    expect(extractChannels({ nothing: true })).toEqual([]);
  });

  it("maps feeds to languages from the title or encoder host", () => {
    expect(FALLBACK_CHANNELS.map(feedLanguage)).toEqual(["en", "fr", "ar", "he"]);
  });

  it("lists channels from every region page, deduplicated, with logos and EPG", async () => {
    const { a, ctx, f } = setup({
      [`${API}69f250bfaa852e43acd716b9`]: () => Response.json(page([en, he])),
      [`${API}69f250caaa852e43acd716bc`]: () => Response.json(page([fr, en])),
      [`${API}69f250d1aa852e43acd716bf`]: () => new Response("down", { status: 503 }),
    });
    const list = await a.live.listChannels(ctx);
    expect(list.map((c) => c.id)).toEqual(["i24news-en", "i24news-he", "i24news-fr"]);
    expect(list[0]).toMatchObject({ name: "i24NEWS English", logo: "https://img/en.png", epgUrl: "https://epg.i24news.tv/xmlTV_EN.xml", language: "en" });
    const call = f.calls.find((c) => c.url.endsWith("69f250caaa852e43acd716bc"));
    expect(call?.headers).toMatchObject({ "x-tenant-id": "i24israel", regioncode: "french", platform: "web" });

    const streams = await a.live.resolveStreams("i24news-en", ctx);
    expect(streams).toEqual([{ url: en.videoUrl, format: "hls", label: "Auto", source: "insight-api", geo: "unknown" }]);
  });

  it("adds the last known URL as backup when the API returns a new one", async () => {
    const moved = { ...en, videoUrl: "https://new-encoder.example.com/en/master.m3u8" };
    const { a, ctx } = setup({ [API]: () => Response.json(page([moved])) });
    const streams = await a.live.resolveStreams("i24news-en", ctx);
    expect(streams.map((s) => [s.label, s.url])).toEqual([
      ["Auto", moved.videoUrl],
      ["Backup", en.videoUrl],
    ]);
  });

  it("falls back to the last known channel list when the API is down", async () => {
    const { a, ctx } = setup({});
    const list = await a.live.listChannels(ctx);
    expect(list.map((c) => c.id)).toEqual(["i24news-en", "i24news-fr", "i24news-ar", "i24news-he"]);
  });
});
