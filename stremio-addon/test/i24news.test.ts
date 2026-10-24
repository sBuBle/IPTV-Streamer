import { describe, expect, it } from "vitest";
import { silentLogger } from "../src/logger.js";
import { extractPolicyKey, tokenExpiry } from "../src/providers/i24news/brightcove.js";
import { I24NewsAdapter } from "../src/providers/i24news/index.js";
import { fakeFetch, testConfig } from "./helpers.js";

const exp = 1_900_000_000;
const playback = {
  id: "111",
  sources: [
    { type: "application/x-mpegURL", src: `https://bcovlive-a.akamaihd.net/x/en/playlist.m3u8?hdnea=exp=${exp}~acl=/*~hmac=ab` },
    { type: "application/x-mpegURL", src: `https://bcovlive-a.akamaihd.net/x/en/playlist.m3u8?hdnea=exp=${exp}~acl=/*~hmac=ab` },
    { type: "application/dash+xml", src: "https://drm.example.com/x.mpd", key_systems: { "com.widevine.alpha": {} } },
    { type: "application/x-mpegURL", src: "http://insecure.example.com/x.m3u8" },
  ],
};

function ctx(fetch: typeof globalThis.fetch, env: Record<string, string> = {}) {
  const config = testConfig({ I24_LIVE_VIDEO_IDS: "en:111", I24_BRIGHTCOVE_PLAYER_ID: "playerA", ...env });
  return { config, ctx: { fetch, logger: silentLogger, config, signal: new AbortController().signal } };
}

describe("i24NEWS adapter", () => {
  it("reports missing config as errors instead of inventing feeds", () => {
    const a = new I24NewsAdapter(testConfig().providers.i24news);
    expect(a.issues().map((i) => i.severity)).toEqual(["error", "error"]);
  });

  it("lists only configured feeds", async () => {
    const { config } = ctx(fetch, { I24_LIVE_VIDEO_IDS: "en:1,he:2" });
    const a = new I24NewsAdapter(config.providers.i24news);
    const list = await a.live.listChannels();
    expect(list.map((c) => c.id)).toEqual(["i24news-en", "i24news-he"]);
  });

  it("resolves fresh HTTPS HLS sources through the Playback API with the player's policy key", async () => {
    const f = fakeFetch({
      "https://players.brightcove.net/5377161796001/playerA_default/index.min.js": () => new Response('x={accountId:"5377161796001",policyKey:"BCpkTEST-key_1"}'),
      "https://edge.api.brightcove.com/playback/v1/accounts/5377161796001/videos/111": () => Response.json(playback),
    });
    const { config, ctx: c } = ctx(f.fetch);
    const a = new I24NewsAdapter(config.providers.i24news);
    const streams = await a.live.resolveStreams("i24news-en", c);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ format: "hls", source: "brightcove-playback-api", expiresAt: exp * 1000 });
    expect(f.calls.find((x) => x.url.includes("edge.api"))?.headers.accept).toBe("application/json;pk=BCpkTEST-key_1");

    await a.live.resolveStreams("i24news-en", c);
    expect(f.calls.filter((x) => x.url.includes("players.brightcove.net"))).toHaveLength(1);
  });

  it("extracts policy keys and token expiry", () => {
    expect(extractPolicyKey(`policyKey: 'BCpkADawqM1abc'`)).toBe("BCpkADawqM1abc");
    expect(extractPolicyKey("no key here")).toBeUndefined();
    expect(tokenExpiry("https://x/a.m3u8?hdnea=st=1~exp=1700000000~acl=/*")).toBe(1_700_000_000_000);
    expect(tokenExpiry("https://x/a.m3u8")).toBeUndefined();
  });
});
