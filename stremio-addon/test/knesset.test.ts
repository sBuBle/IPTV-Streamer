import { describe, expect, it } from "vitest";
import { silentLogger } from "../src/logger.js";
import { KnessetAdapter } from "../src/providers/knesset/index.js";
import { fakeFetch, testConfig } from "./helpers.js";

function setup(env: Record<string, string>, routes: Parameters<typeof fakeFetch>[0] = {}) {
  const config = testConfig(env);
  const f = fakeFetch(routes);
  return { a: new KnessetAdapter(config.providers.knesset), ctx: { fetch: f.fetch, logger: silentLogger, config, signal: new AbortController().signal } };
}

describe("Knesset adapter", () => {
  it("needs a URL or a page", () => {
    expect(setup({}).a.issues()[0]?.severity).toBe("error");
  });

  it("reads the manifest from the live page and keeps the configured URL as backup", async () => {
    const { a, ctx } = setup(
      { KNESSET_LIVE_PAGE: "https://knesset.example/live", KNESSET_LIVE_URL: "https://backup.example/live.m3u8" },
      { "https://knesset.example/live": () => new Response(`<script>player.src("https://kneset.gostreaming.tv/live/playlist.m3u8")</script>`) },
    );
    const s = await a.live.resolveStreams("knesset-99", ctx);
    expect(s.map((x) => [x.url, x.label, x.source])).toEqual([
      ["https://kneset.gostreaming.tv/live/playlist.m3u8", "Auto", "knesset-live-page"],
      ["https://backup.example/live.m3u8", "Backup", "config"],
    ]);
  });

  it("falls back to the configured URL when the page is down", async () => {
    const { a, ctx } = setup({ KNESSET_LIVE_PAGE: "https://knesset.example/live", KNESSET_LIVE_URL: "https://backup.example/live.m3u8" });
    const s = await a.live.resolveStreams("knesset-99", ctx);
    expect(s.map((x) => x.url)).toEqual(["https://backup.example/live.m3u8"]);
  });

  it("returns nothing for unknown channels", async () => {
    const { a, ctx } = setup({ KNESSET_LIVE_URL: "https://backup.example/live.m3u8" });
    expect(await a.live.resolveStreams("other", ctx)).toEqual([]);
  });
});
