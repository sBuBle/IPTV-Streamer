/**
 * Discovery helper. Run it on the host that serves the add-on to see what each provider finds from there:
 * channels and stream URLs from provider APIs, and manifest URLs embedded in any pages you pass.
 *
 *   npm run discover                 # provider APIs and default pages
 *   npm run discover -- <url> <url>  # also scan these pages for manifest URLs
 */
import { loadConfig } from "../src/config.js";
import { silentLogger } from "../src/logger.js";
import { extractManifestUrls } from "../src/media/extract.js";
import { buildProviders } from "../src/providers/index.js";
import { loadDotEnv } from "./env.js";

loadDotEnv();
const config = loadConfig(process.env);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

for (const p of buildProviders(config)) {
  console.log(`\n=== provider ${p.id}`);
  for (const issue of p.issues()) console.log(`  ${issue.severity}: ${issue.message}`);
  if (!p.live) continue;
  const ctx = { fetch, logger: silentLogger, config, signal: AbortSignal.timeout(30_000) };
  try {
    for (const ch of await p.live.listChannels(ctx)) {
      const streams = await p.live.resolveStreams(ch.id, ctx);
      console.log(`  ${ch.id} (${ch.name}): ${streams.map((s) => `${s.label} ${s.url}`).join(" | ") || "no stream"}`);
    }
  } catch (err) {
    console.log(`  failed: ${(err as Error).message}`);
  }
}

for (const url of process.argv.slice(2).filter((a) => a.startsWith("http"))) {
  console.log(`\n=== page ${url}`);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    console.log(`  HTTP ${res.status}, ${text.length} bytes${res.url !== url ? `, redirected to ${res.url}` : ""}`);
    const manifests = extractManifestUrls(text, res.url);
    console.log(manifests.length ? `  manifests:\n    ${manifests.join("\n    ")}` : "  no manifest URLs in the HTML");
  } catch (err) {
    console.log(`  failed: ${(err as Error).message}`);
  }
}
