/**
 * Playback verification. Run this on the host that serves the add-on (or any machine whose location
 * you want to test from). For every channel, and for the newest episode of a few programs of every VOD
 * provider, it resolves fresh URLs, probes them, decodes a few seconds with ffprobe and records the result.
 * Only a decoded pass marks an item verified.
 *
 *   npm run verify -- --location IL [--only <stremio id>] [--seconds 8] [--vod 3]
 *                     [--push https://your-worker.example.com]   (needs ADMIN_TOKEN)
 *
 * --vod N checks N programs per VOD provider (default 3, 0 skips VOD).
 */
import { buildAddon } from "../src/bootstrap.js";
import { loadConfig } from "../src/config.js";
import type { ResolvedStream, StreamCheck } from "../src/domain/types.js";
import { createLogger } from "../src/logger.js";
import { probeHls } from "../src/media/probe.js";
import { openNodeSqlite } from "../src/storage/node-sqlite.js";
import { SqlStore } from "../src/storage/sql.js";
import { parseItemId, vodEpisodeId } from "../src/stremio/ids.js";
import { redactUrl } from "../src/util/http.js";
import { verifyPlayback } from "../src/verify/playback.js";
import { argValue, loadDotEnv } from "./env.js";

loadDotEnv();
const config = loadConfig(process.env);
const location = argValue("location") ?? config.verifierLocation;
const only = argValue("only");
const seconds = Number(argValue("seconds") ?? 8);
const push = argValue("push");
const vodPrograms = Number(argValue("vod") ?? 3);
const logger = createLogger("warn");
const store = new SqlStore(openNodeSqlite(config.databasePath));
await store.init();
const { service, registry } = buildAddon({ config, logger, store });

if (!location) console.warn("No --location given; results are stored without a location label.");
for (const p of registry.healthReport()) {
  for (const issue of p.issues) console.warn(`[${p.id}] ${issue.severity}: ${issue.message}`);
}

const checks: StreamCheck[] = [];

/** Probes and decodes the streams of one item until one decodes. Returns whether it did. */
async function checkItem(item: { itemId: string; provider: string; name: string }, streams: ResolvedStream[]): Promise<boolean> {
  const base = { itemId: item.itemId, provider: item.provider, location };
  const playable = streams.filter((s) => s.format !== "external");
  if (playable.length === 0) {
    const error = streams.length ? "only external links, nothing to play" : "no stream resolved";
    checks.push({ ...base, kind: "probe", ok: false, checkedAt: Date.now(), detail: {}, error });
    console.log(`✗ ${item.name}: ${error} (${registry.healthReport().find((p) => p.id === item.provider)?.lastError ?? "no error recorded"})`);
    return false;
  }
  if (location && location !== "IL" && playable.every((s) => s.geo === "israel-only")) {
    // A failure from abroad says nothing about viewers in Israel, so it is not recorded.
    console.log(`– ${item.name}: skipped, Israel-only stream and this check runs from ${location}`);
    return true;
  }
  for (const s of playable) {
    const host = new URL(s.url).host;
    if (s.format === "dash") {
      // probeHls only understands HLS; ffprobe decodes DASH directly.
      const play = await verifyPlayback(s, { seconds });
      checks.push({ ...base, kind: "playback", ok: play.ok, checkedAt: Date.now(), streamHost: host, detail: { ...play, url: redactUrl(s.url) }, error: play.error });
      console.log(`${play.ok ? "✓" : "✗"} ${item.name} [${s.label}]: ${play.ok ? "decoded" : play.error}`);
      if (play.ok) return true;
      continue;
    }
    const probe = await probeHls(s, { timeoutMs: config.requestTimeoutMs });
    checks.push({ ...base, kind: "probe", ok: probe.ok, checkedAt: Date.now(), streamHost: host, detail: { ...probe, url: redactUrl(s.url) }, error: probe.error });
    if (!probe.ok) {
      console.log(`✗ ${item.name} [${s.label}]: probe failed at ${probe.stage}: ${probe.error}`);
      continue;
    }
    const play = await verifyPlayback(s, { seconds });
    checks.push({ ...base, kind: "playback", ok: play.ok, checkedAt: Date.now(), streamHost: host, detail: { ...play, url: redactUrl(s.url) }, error: play.error });
    const tracks = play.streams.filter((t) => t.type !== "other").map((t) => `${t.type}:${t.codec}${t.height ? `@${t.height}p` : ""}=${t.framesDecoded}f`).join(" ");
    console.log(`${play.ok ? "✓" : "✗"} ${item.name} [${s.label}]: ${play.ok ? "decoded" : play.error} (${tracks || "no tracks"})`);
    if (play.ok) return true;
  }
  return false;
}

const channels = (await service.channels()).filter((c) => !only || c.stremioId === only);
if (channels.length === 0 && (!only || only.startsWith("iltv:live:"))) console.warn("No channels to verify. Check the provider settings above.");
for (const ch of channels) {
  const ok = await checkItem({ itemId: ch.stremioId, provider: ch.provider, name: ch.name }, await service.resolve(ch));
  if (!ok) process.exitCode = 1;
}

// VOD: the newest episode of the most recently updated programs of each provider.
if (vodPrograms > 0 && (!only || only.startsWith("iltv:vod:"))) {
  const onlyParsed = only ? parseItemId(only) : undefined;
  for (const provider of service.vod.vodProviders()) {
    if (onlyParsed?.kind === "vod" && onlyParsed.provider !== provider.id) continue;
    const programs = (await service.vod.programs(provider.id))
      .filter((p) => !onlyParsed || (onlyParsed.kind === "vod" && p.id === onlyParsed.programId))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, onlyParsed ? 1 : vodPrograms);
    if (programs.length === 0) console.log(`✗ ${provider.name} VOD: no programs (${registry.healthReport().find((p) => p.id === provider.id)?.lastError ?? "no error recorded"})`);
    for (const program of programs) {
      const detail = await service.vod.program(provider.id, program.id);
      const episode =
        onlyParsed?.kind === "vod" && onlyParsed.episodeId ? detail?.episodes.find((e) => e.id === onlyParsed.episodeId) : detail?.episodes[detail.episodes.length - 1];
      if (!detail || !episode) {
        console.log(`✗ ${provider.name} / ${program.title}: no episodes found`);
        process.exitCode = 1;
        continue;
      }
      console.log(`  ${provider.name} / ${program.title}: ${detail.episodes.length} episodes`);
      const itemId = vodEpisodeId(provider.id, program.id, episode.id);
      const name = `${provider.name} / ${program.title} S${episode.season}E${episode.episode} ${episode.title}`;
      const ok = await checkItem({ itemId, provider: provider.id, name }, await service.vod.resolve(provider.id, program.id, episode.id));
      if (!ok) process.exitCode = 1;
    }
  }
}

for (const c of checks) await store.recordCheck(c);
console.log(`\nRecorded ${checks.length} checks in ${config.databasePath}${location ? ` (location ${location})` : ""}.`);

if (push) {
  if (!config.adminToken) throw new Error("--push needs ADMIN_TOKEN (the same value as on the remote add-on)");
  const res = await fetch(`${push.replace(/\/+$/, "")}/admin/checks`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.adminToken}` },
    body: JSON.stringify(checks),
  });
  console.log(`Pushed to ${push}: HTTP ${res.status} ${await res.text()}`);
}
await store.close();
