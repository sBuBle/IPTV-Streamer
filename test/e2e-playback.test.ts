import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAddon } from "../src/bootstrap.js";
import { silentLogger } from "../src/logger.js";
import { probeHls } from "../src/media/probe.js";
import { MemoryStore } from "../src/storage/memory.js";
import { verifyPlayback } from "../src/verify/playback.js";
import { channel, hasFfmpeg, makeHlsFixture, serveDir, staticProvider, testConfig } from "./helpers.js";

/**
 * Full path with real media: Stremio manifest -> Live TV catalog -> channel meta -> stream -> decoded
 * video and audio. The media is a local ffmpeg-generated HLS stream, not a broadcaster.
 */
describe.skipIf(!hasFfmpeg())("end to end with real HLS media", () => {
  let fixture: ReturnType<typeof makeHlsFixture>;
  let server: Awaited<ReturnType<typeof serveDir>>;

  beforeAll(async () => {
    fixture = makeHlsFixture();
    server = await serveDir(fixture.dir);
  });
  afterAll(async () => {
    await server?.close();
    fixture?.cleanup();
  });

  it("Stremio -> Live TV -> channel -> working broadcast", async () => {
    const store = new MemoryStore();
    const provider = staticProvider("local", [channel({ id: "test-1", provider: "local", name: "Test Channel" })], {
      "test-1": [{ url: `${server.base}/master.m3u8`, format: "hls", label: "Auto", source: "fixture", geo: "unknown" }],
    });
    const { app, service } = buildAddon({ config: testConfig({ BASE_URL: "https://tv.example.com" }), logger: silentLogger, store, providers: [provider] });

    const manifest = (await (await app.request("/manifest.json")).json()) as any;
    const catalogId = manifest.catalogs[0].id;
    const metas = ((await (await app.request(`/catalog/tv/${catalogId}.json`)).json()) as any).metas;
    const meta = ((await (await app.request(`/meta/tv/${metas[0].id}.json`)).json()) as any).meta;
    const streams = ((await (await app.request(`/stream/tv/${meta.id}.json`)).json()) as any).streams;
    expect(streams).toHaveLength(1);

    const probe = await probeHls({ url: streams[0].url }, { timeoutMs: 5000 });
    expect(probe).toMatchObject({ ok: true, stage: "done", segmentType: "mpegts", live: false });

    const play = await verifyPlayback({ url: streams[0].url }, { seconds: 3 });
    expect(play.error).toBeUndefined();
    expect(play.ok).toBe(true);
    expect(play.videoFrames).toBeGreaterThanOrEqual(25);
    expect(play.audioFrames).toBeGreaterThan(10);
    expect(play.streams.find((s) => s.type === "video")).toMatchObject({ codec: "h264", width: 320, height: 180 });

    await store.recordCheck({ itemId: meta.id, provider: "local", kind: "playback", ok: true, checkedAt: Date.now(), detail: {} });
    expect((await service.healthByItem()).get(meta.id)?.status).toBe("verified");
  });

  it("never mistakes a web page for a stream", async () => {
    const probe = await probeHls({ url: `${server.base}/page.m3u8` }, { timeoutMs: 5000 });
    expect(probe).toMatchObject({ ok: false, stage: "manifest" });
    expect(probe.error).toMatch(/Not an HLS playlist/);
    const play = await verifyPlayback({ url: `${server.base}/page.m3u8` }, { seconds: 2 });
    expect(play.ok).toBe(false);
  });

  it("fails playback for a stream without audio and for a missing stream", async () => {
    const silent = await verifyPlayback({ url: `${server.base}/video-only.m3u8` }, { seconds: 2 });
    expect(silent).toMatchObject({ ok: false, error: "no audio track" });
    const missing = await verifyPlayback({ url: `${server.base}/missing.m3u8` }, { seconds: 2, timeoutMs: 20_000 });
    expect(missing.ok).toBe(false);
    const probe = await probeHls({ url: `${server.base}/missing.m3u8` }, { timeoutMs: 5000 });
    expect(probe.error).toMatch(/HTTP 404/);
  });

  it("records probe checks from the health monitor without marking anything verified", async () => {
    const store = new MemoryStore();
    const provider = staticProvider("local", [channel({ id: "ok", provider: "local" }), channel({ id: "html", provider: "local" })], {
      ok: [{ url: `${server.base}/master.m3u8`, format: "hls", source: "fixture", geo: "unknown" }],
      html: [{ url: `${server.base}/page.m3u8`, format: "hls", source: "fixture", geo: "unknown" }],
    });
    const { service } = buildAddon({ config: testConfig(), logger: silentLogger, store, providers: [provider] });
    const checks = await service.probeAll("test");
    expect(checks.map((c) => [c.itemId, c.ok])).toEqual([
      ["iltv:live:local:ok", true],
      ["iltv:live:local:html", false],
    ]);
    const health = await service.healthByItem();
    expect(health.get("iltv:live:local:ok")?.status).toBe("reachable");
    expect(health.get("iltv:live:local:html")?.status).toBe("failing");
  });
});
