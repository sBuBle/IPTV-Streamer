/**
 * End-to-end smoke test. Walks a running add-on over HTTP the way Stremio does:
 * manifest -> every catalog (plus a search) -> a few programs' meta -> an episode's streams -> the stream itself.
 * Each step is timed; a step slower than --slow-ms counts as a failure, because Stremio gives up on slow add-ons.
 *
 *   npm run smoke -- [--url http://localhost:7000] [--items 3] [--decode] [--location US] [--slow-ms 15000] [--out smoke.json]
 *
 * --decode also decodes a few seconds of each stream with ffprobe (needs ffmpeg). Without it, streams are probed
 * (playlist, variant and first segment). Israel-only streams are not fetched when --location is not IL.
 */
import { writeFileSync } from "node:fs";
import type { ResolvedStream } from "../src/domain/types.js";
import { probeHls } from "../src/media/probe.js";
import type { Manifest, Meta, MetaPreview, Stream } from "../src/stremio/schemas.js";
import { redactUrl } from "../src/util/http.js";
import { verifyPlayback } from "../src/verify/playback.js";
import { argValue } from "./env.js";

const base = (argValue("url") ?? "http://localhost:7000").replace(/\/+$/, "");
const itemsPerCatalog = Number(argValue("items") ?? 3);
const decode = process.argv.includes("--decode");
const location = argValue("location");
const slowMs = Number(argValue("slow-ms") ?? 15000);
const out = argValue("out");

interface Step {
  step: string;
  ok: boolean;
  ms: number;
  detail?: string;
}
const steps: Step[] = [];

function record(step: string, ok: boolean, ms: number, detail?: string): void {
  const slow = ok && ms > slowMs;
  steps.push({ step, ok: ok && !slow, ms, detail: slow ? `slow (${ms} ms > ${slowMs} ms)${detail ? `; ${detail}` : ""}` : detail });
  console.log(`${ok && !slow ? "✓" : "✗"} ${step} ${ms} ms${detail ? `: ${detail}` : ""}${slow ? " (slow)" : ""}`);
}

async function get<T>(path: string): Promise<{ ok: boolean; status: number; body?: T; ms: number; error?: string }> {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(60_000) });
    const body = res.headers.get("content-type")?.includes("json") ? ((await res.json()) as T) : undefined;
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

const enc = encodeURIComponent;

/** Probes (and with --decode, decodes) the first playable stream. */
async function checkStreams(label: string, streams: Stream[]): Promise<void> {
  const playable = streams.filter((s) => s.url);
  if (playable.length === 0) {
    const links = streams.filter((s) => s.externalUrl).length;
    record(`${label} playable stream`, links > 0, 0, links ? `only ${links} link(s) to the broadcaster's site (expected for link-only providers)` : "no streams");
    return;
  }
  const s = playable[0]!;
  if (location !== "IL" && /Plays only in Israel/.test(s.title ?? "")) {
    record(`${label} stream`, true, 0, `Israel-only, not fetched from ${location ?? "here"}`);
    return;
  }
  const resolved: ResolvedStream = {
    url: s.url!,
    format: /\.mpd(\?|$)/.test(s.url!) ? "dash" : /\.mp4(\?|$)/.test(s.url!) ? "mp4" : "hls",
    source: "smoke",
    geo: "unknown",
    headers: s.behaviorHints?.proxyHeaders?.request,
  };
  if (resolved.format === "hls") {
    const started = Date.now();
    const probe = await probeHls(resolved, { timeoutMs: 15_000 });
    record(`${label} probe ${redactUrl(s.url!)}`, probe.ok, Date.now() - started, probe.ok ? undefined : `${probe.stage}: ${probe.error}`);
    if (!probe.ok) return;
  }
  if (decode) {
    const play = await verifyPlayback(resolved, { seconds: 6 });
    record(`${label} decode`, play.ok, play.durationMs, play.ok ? `${play.videoFrames} video / ${play.audioFrames} audio frames` : play.error);
  }
}

const manifest = await get<Manifest>("/manifest.json");
record("manifest", manifest.ok && !!manifest.body?.catalogs?.length, manifest.ms, manifest.error ?? `${manifest.body?.catalogs?.length ?? 0} catalogs`);
if (!manifest.body) process.exit(1);

for (const cat of manifest.body.catalogs) {
  const label = `[${cat.name}]`;
  const list = await get<{ metas: MetaPreview[] }>(`/catalog/${cat.type}/${enc(cat.id)}.json`);
  const metas = list.body?.metas ?? [];
  record(`${label} catalog`, list.ok && metas.length > 0, list.ms, list.error ?? `${metas.length} items`);
  if (metas.length === 0) continue;

  if (metas.length >= 100) {
    const page2 = await get<{ metas: MetaPreview[] }>(`/catalog/${cat.type}/${enc(cat.id)}/skip=100.json`);
    record(`${label} page 2`, page2.ok && (page2.body?.metas.length ?? 0) > 0, page2.ms, `${page2.body?.metas.length ?? 0} items`);
  }
  const word = metas[0]!.name.split(/\s+/).find((w) => w.length >= 3) ?? metas[0]!.name;
  const search = await get<{ metas: MetaPreview[] }>(`/catalog/${cat.type}/${enc(cat.id)}/search=${enc(word)}.json`);
  record(`${label} search "${word}"`, search.ok && (search.body?.metas.length ?? 0) > 0, search.ms, `${search.body?.metas.length ?? 0} results`);

  for (const item of metas.slice(0, itemsPerCatalog)) {
    const itemLabel = `${label} ${item.name}`;
    const meta = await get<{ meta: Meta | null }>(`/meta/${item.type}/${enc(item.id)}.json`);
    const m = meta.body?.meta;
    const videos = m?.videos ?? [];
    record(`${itemLabel} meta`, meta.ok && !!m && (item.type !== "series" || videos.length > 0), meta.ms, meta.error ?? (m ? (item.type === "series" ? `${videos.length} episodes` : "ok") : `HTTP ${meta.status}`));
    if (!m) continue;
    // Stremio opens the newest episode most often, so that is the one checked.
    const newest = [...videos].sort((a, b) => (a.released && b.released ? b.released.localeCompare(a.released) : (b.season ?? 0) - (a.season ?? 0) || (b.episode ?? 0) - (a.episode ?? 0)))[0];
    const streamId = item.type === "series" ? newest?.id : item.id;
    if (!streamId) continue;
    const streams = await get<{ streams: Stream[] }>(`/stream/${item.type}/${enc(streamId)}.json`);
    const list = streams.body?.streams ?? [];
    record(`${itemLabel} streams`, streams.ok && list.length > 0, streams.ms, streams.error ?? `${list.length} streams`);
    if (list.length) await checkStreams(itemLabel, list);
  }
}

const failed = steps.filter((s) => !s.ok);
const times = steps.filter((s) => s.ms > 0).map((s) => s.ms).sort((a, b) => a - b);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor((times.length * p) / 100))] ?? 0;
console.log(`\n${steps.length - failed.length}/${steps.length} steps passed. Response times: median ${pct(50)} ms, p90 ${pct(90)} ms, max ${pct(100)} ms.`);
for (const f of failed) console.log(`  ✗ ${f.step}: ${f.detail ?? "failed"}`);
if (out) writeFileSync(out, JSON.stringify({ base, location, decode, steps }, null, 2));
if (failed.length) process.exitCode = 1;
