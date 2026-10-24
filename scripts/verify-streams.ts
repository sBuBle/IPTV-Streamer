/**
 * Playback verification. Run this on the host that serves the add-on (or any machine whose location
 * you want to test from). For every channel it resolves fresh URLs, probes them, decodes a few seconds
 * with ffprobe and records the result. Only a decoded pass marks a channel verified.
 *
 *   npm run verify -- --location IL [--only iltv:live:knesset:knesset-99] [--seconds 8]
 *                     [--push https://your-worker.example.com]   (needs ADMIN_TOKEN)
 */
import { buildAddon } from "../src/bootstrap.js";
import { loadConfig } from "../src/config.js";
import type { StreamCheck } from "../src/domain/types.js";
import { createLogger } from "../src/logger.js";
import { probeHls } from "../src/media/probe.js";
import { openNodeSqlite } from "../src/storage/node-sqlite.js";
import { SqlStore } from "../src/storage/sql.js";
import { redactUrl } from "../src/util/http.js";
import { verifyPlayback } from "../src/verify/playback.js";
import { argValue, loadDotEnv } from "./env.js";

loadDotEnv();
const config = loadConfig(process.env);
const location = argValue("location") ?? config.verifierLocation;
const only = argValue("only");
const seconds = Number(argValue("seconds") ?? 8);
const push = argValue("push");
const logger = createLogger("warn");
const store = new SqlStore(openNodeSqlite(config.databasePath));
await store.init();
const { service, registry } = buildAddon({ config, logger, store });

if (!location) console.warn("No --location given; results are stored without a location label.");
for (const p of registry.healthReport()) {
  for (const issue of p.issues) console.warn(`[${p.id}] ${issue.severity}: ${issue.message}`);
}

const channels = (await service.channels()).filter((c) => !only || c.stremioId === only);
if (channels.length === 0) console.warn("No channels to verify. Check the provider settings above.");

const checks: StreamCheck[] = [];
for (const ch of channels) {
  const streams = await service.resolve(ch);
  const base = { itemId: ch.stremioId, provider: ch.provider, location };
  if (streams.length === 0) {
    const fail: StreamCheck = { ...base, kind: "probe", ok: false, checkedAt: Date.now(), detail: {}, error: "no stream resolved" };
    checks.push(fail);
    console.log(`✗ ${ch.name}: no stream resolved (${registry.healthReport().find((p) => p.id === ch.provider)?.lastError ?? "no error recorded"})`);
    continue;
  }

  let verified = false;
  for (const s of streams) {
    const host = new URL(s.url).host;
    const probe = await probeHls(s, { timeoutMs: config.requestTimeoutMs });
    checks.push({ ...base, kind: "probe", ok: probe.ok, checkedAt: Date.now(), streamHost: host, detail: { ...probe, url: redactUrl(s.url) }, error: probe.error });
    if (!probe.ok) {
      console.log(`✗ ${ch.name} [${s.label}]: probe failed at ${probe.stage}: ${probe.error}`);
      continue;
    }
    const play = await verifyPlayback(s, { seconds });
    checks.push({ ...base, kind: "playback", ok: play.ok, checkedAt: Date.now(), streamHost: host, detail: { ...play, url: redactUrl(s.url) }, error: play.error });
    const tracks = play.streams.filter((t) => t.type !== "other").map((t) => `${t.type}:${t.codec}${t.height ? `@${t.height}p` : ""}=${t.framesDecoded}f`).join(" ");
    console.log(`${play.ok ? "✓" : "✗"} ${ch.name} [${s.label}]: ${play.ok ? "decoded" : play.error} (${tracks || "no tracks"})`);
    if (play.ok) {
      verified = true;
      break;
    }
  }
  if (!verified) process.exitCode = 1;
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
