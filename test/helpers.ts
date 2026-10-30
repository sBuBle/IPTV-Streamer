import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { loadConfig, type Config, type Env } from "../src/config.js";
import type { LiveChannel, ResolvedStream } from "../src/domain/types.js";
import type { ProviderAdapter } from "../src/providers/types.js";

export function testConfig(env: Env = {}): Config {
  return loadConfig({ DATABASE_PATH: ":memory:", HEALTH_PROBE_INTERVAL_MIN: "0", PROVIDER_TIMEOUT_MS: "2000", REQUEST_TIMEOUT_MS: "2000", KAN_SITEMAP: "none", KNESSET_VOD_SITEMAP: "none", ...env });
}

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** fetch replacement that answers from a URL-prefix table and records calls. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push({ url: url.toString(), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const key = Object.keys(routes).find((prefix) => url.toString().startsWith(prefix));
    if (!key) return new Response("not found", { status: 404 });
    const res = await routes[key]!(url, init);
    Object.defineProperty(res, "url", { value: url.toString() });
    return res;
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function channel(over: Partial<LiveChannel> & { id: string; provider: string }): LiveChannel {
  return { name: over.id, description: "Test channel", genres: ["News"], language: "he", geo: "unknown", ...over };
}

/** In-memory provider for tests. */
export function staticProvider(id: string, channels: LiveChannel[], streams: Record<string, ResolvedStream[]>, opts: { fail?: boolean } = {}): ProviderAdapter {
  return {
    id,
    name: `Provider ${id}`,
    issues: () => [],
    live: {
      listChannels: async () => {
        if (opts.fail) throw new Error(`${id} is down`);
        return channels;
      },
      resolveStreams: async (channelId) => streams[channelId] ?? [],
    },
  };
}

const CONTENT_TYPES: Record<string, string> = { ".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t", ".html": "text/html" };

/** Serves a directory over HTTP on 127.0.0.1 with a random port. */
export async function serveDir(dir: string): Promise<{ server: Server; base: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = readFileSync(join(dir, path));
      res.writeHead(200, { "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a real HLS VOD stream (test pattern + tone) with ffmpeg, a master playlist pointing to it,
 * a video-only variant, and an HTML page disguised as a playlist.
 */
export function makeHlsFixture(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "iltv-hls-"));
  const common = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25", "-t", "6"];
  const hls = ["-c:v", "libx264", "-preset", "ultrafast", "-g", "25", "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod"];
  execFileSync("ffmpeg", [...common, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "6", "-c:a", "aac", "-shortest", ...hls, "-hls_segment_filename", join(dir, "av_%02d.ts"), join(dir, "av.m3u8")]);
  execFileSync("ffmpeg", [...common, "-an", ...hls, "-hls_segment_filename", join(dir, "v_%02d.ts"), join(dir, "video-only.m3u8")]);
  writeFileSync(join(dir, "master.m3u8"), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x180,CODECS="avc1.42c00d,mp4a.40.2"\nav.m3u8\n');
  writeFileSync(join(dir, "page.m3u8"), "<!doctype html><html><body>Watch live!</body></html>");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
