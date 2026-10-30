/**
 * VOD coverage audit. Runs every VOD adapter against the live sites, opens every program, and compares what
 * the add-on finds with what the broadcaster itself lists (sitemaps, declared episode/season counts).
 *
 *   npm run audit:vod -- [--provider kan] [--limit 50] [--out audit.json] [--concurrency 4]
 *
 * Counts discovery only. Whether episodes play is the verifier's job (npm run verify).
 */
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { buildProviders } from "../src/providers/index.js";
import { errorMessage } from "../src/providers/registry.js";
import type { ProviderContext, VodProgram, VodProgramDetail } from "../src/providers/types.js";
import { getJson, getText } from "../src/util/http.js";
import { mapPool } from "../src/util/pool.js";
import { sitemapLocs as readSitemap } from "../src/util/sitemap.js";
import { argValue, loadDotEnv } from "./env.js";

loadDotEnv();
const config = loadConfig({ MAKO_VOD: "catalog", REQUEST_TIMEOUT_MS: "20000", ...process.env });
const logger = createLogger("warn");
const onlyProvider = argValue("provider");
const limit = Number(argValue("limit") ?? Infinity);
const concurrency = Number(argValue("concurrency") ?? 4);
const out = argValue("out");

const ctx = (): ProviderContext => ({ fetch, logger, config, signal: new AbortController().signal });

interface ProgramAudit {
  id: string;
  title: string;
  kind: string;
  episodes: number;
  seasons: number[];
  duplicateEpisodeNumbers: number;
  error?: string;
  /** What the broadcaster says, when it says it. */
  expectedEpisodes?: number;
  expectedSeasons?: number;
}

function auditDetail(p: VodProgram, d: VodProgramDetail | undefined, error?: string): ProgramAudit {
  const eps = d?.episodes ?? [];
  const keys = eps.map((e) => `${e.season}:${e.episode}`);
  return {
    id: p.id,
    title: p.title,
    kind: p.kind,
    episodes: eps.length,
    seasons: [...new Set(eps.map((e) => e.season))].sort((a, b) => a - b),
    duplicateEpisodeNumbers: keys.length - new Set(keys).size,
    error: error ?? (d ? undefined : "program not found"),
  };
}

async function text(url: string): Promise<string> {
  return (await getText(url, { timeoutMs: 30000, retries: 2 })).text;
}

const sitemapLocs = (url: string) => readSitemap(url, text);

/** Per provider: program ids and episode counts the broadcaster publishes, for comparison. */
async function reference(provider: string, ids: string[]): Promise<{ programs: Map<string, number>; note: string } | undefined> {
  try {
    if (provider === "i24news") {
      // The series endpoint says how many episodes a show has (amountOfEpisodes), even when it serves fewer.
      const programs = new Map<string, number>();
      await mapPool(ids, 4, async (id) => {
        for (const region of ["all", "french", "arabic"]) {
          const raw = (await getJson(`${config.providers.i24news.apiUrl.replace(/\/+$/, "")}/interface/pages/series/${id}`, {
            timeoutMs: 30000,
            headers: { platform: "web", "x-device-type": "web", "x-tenant-id": config.providers.i24news.tenant, regioncode: region },
          }).catch(() => undefined)) as { amountOfEpisodes?: number } | undefined;
          if (typeof raw?.amountOfEpisodes === "number") return void programs.set(id, raw.amountOfEpisodes);
        }
      });
      return { programs, note: "i24 Insight API amountOfEpisodes per show" };
    }
    if (provider === "kan") {
      const locs = await sitemapLocs("https://www.kan.org.il/media/sitemap/general/siteindex.xml");
      // Kan TV lives under kan-11, kan-actual, kan-news/newstv, dig/digital, archive*, kan-educational; radio stations are left out.
      const tv = locs.filter((u) => /\/content\/(kan\/kan-11|kan\/kan-actual|kan\/news-series|kan-news\/newstv|dig\/digital|archive\d*\/vod)\//.test(u));
      // Episodes per program: those in seasons or sub-sections; unsectioned videos (trailers, clips next to
      // seasons) count only for programs that have nothing else.
      const counts = new Map<string, { sectioned: number; loose: number }>();
      for (const u of tv) {
        const m = u.match(/\/p-(\d+)\/(?:([a-z0-9_]+)\/)?(\d+)?\/?$/i);
        if (!m) continue;
        const c = counts.get(m[1]!) ?? { sectioned: 0, loose: 0 };
        if (m[3]) m[2] ? c.sectioned++ : c.loose++;
        counts.set(m[1]!, c);
      }
      const programs = new Map([...counts].map(([id, c]) => [id, c.sectioned || c.loose]));
      return { programs, note: `Kan sitemap, TV sections only (${tv.length} URLs)` };
    }
    if (provider === "knesset") {
      const locs = await sitemapLocs("https://www.knesset.tv/sitemap.xml");
      const programs = new Map<string, number>();
      for (const u of locs) {
        const m = u.match(/\/tv-shows\/([A-Za-z0-9_-]+)\/(.+)$/);
        if (m && /\d/.test(m[2]!)) programs.set(m[1]!, (programs.get(m[1]!) ?? 0) + 1);
      }
      const committees = new Set(locs.map((u) => u.match(/\/committees\/([^/]+)\/video\//)?.[1]).filter(Boolean));
      return { programs, note: `knesset.tv video sitemaps; also ${committees.size} committees with ${locs.filter((u) => u.includes("/committees/")).length} session videos (not in the add-on)` };
    }
  } catch (err) {
    console.warn(`reference for ${provider} failed: ${errorMessage(err)}`);
  }
  return undefined;
}

const report: Record<string, unknown> = { generatedAt: new Date().toISOString() };
for (const p of buildProviders(config)) {
  if (!p.vod || (onlyProvider && p.id !== onlyProvider)) continue;
  const started = Date.now();
  let programs: VodProgram[];
  try {
    // Sitemap discovery normally runs in the background; the audit waits for it so the count is complete.
    const discover = (p as { discoverFromSitemap?: (c: ProviderContext) => Promise<void> }).discoverFromSitemap?.bind(p) ??
      (p.vod as { discoverFromSitemap?: (c: ProviderContext) => Promise<void> }).discoverFromSitemap?.bind(p.vod);
    if (discover) {
      await p.vod.listPrograms(ctx());
      await discover(ctx());
    }
    programs = await p.vod.listPrograms(ctx());
  } catch (err) {
    console.log(`\n## ${p.name}: listing failed: ${errorMessage(err)}`);
    report[p.id] = { error: errorMessage(err) };
    continue;
  }
  const picked = programs.slice(0, limit);
  let opened = 0;
  let failed = 0;
  // knesset.tv answers 429 when several shows are paged through at once; Mako blocks bursts.
  const audits = await mapPool(picked, p.id === "knesset" || p.id === "mako" ? 1 : concurrency, async (prog) => {
    // A site that refuses every request (bot protection, outage) is not hammered with hundreds more.
    if (failed >= 10 && opened === 0) return auditDetail(prog, undefined, "skipped: the first 10 programs all failed");
    try {
      const detail = await p.vod!.getProgram(prog.id, ctx());
      opened++;
      return auditDetail(prog, detail);
    } catch (err) {
      failed++;
      return auditDetail(prog, undefined, errorMessage(err));
    }
  });
  const ref = await reference(p.id, programs.map((x) => x.id));
  if (ref) for (const a of audits) if (ref.programs.has(a.id)) a.expectedEpisodes = ref.programs.get(a.id);

  const sum = (f: (a: ProgramAudit) => number) => audits.reduce((n, a) => n + f(a), 0);
  const missingPrograms = ref ? [...ref.programs.entries()].filter(([id, n]) => n > 0 && !programs.some((x) => x.id === id)) : [];
  const short = audits.filter((a) => a.expectedEpisodes !== undefined && a.episodes < a.expectedEpisodes);
  const summary = {
    programs: programs.length,
    series: programs.filter((x) => x.kind === "series").length,
    movies: programs.filter((x) => x.kind === "movie").length,
    opened: audits.length,
    episodes: sum((a) => a.episodes),
    seasons: sum((a) => a.seasons.length),
    emptyPrograms: audits.filter((a) => a.episodes === 0 && !a.error).map((a) => `${a.id} ${a.title}`),
    failedPrograms: audits.filter((a) => a.error).map((a) => `${a.id} ${a.title}: ${a.error}`),
    duplicateEpisodeNumbers: sum((a) => a.duplicateEpisodeNumbers),
    reference: ref?.note,
    referencePrograms: ref ? [...ref.programs.values()].filter((n) => n > 0).length : undefined,
    referenceEpisodes: ref ? [...ref.programs.values()].reduce((a, b) => a + b, 0) : undefined,
    programsMissingFromCatalog: missingPrograms.length,
    episodesInMissingPrograms: missingPrograms.reduce((n, [, c]) => n + c, 0),
    missingProgramSample: missingPrograms.slice(0, 30).map(([id, n]) => `${id} (${n} eps)`),
    programsWithFewerEpisodesThanSite: short.length,
    shortSample: short.slice(0, 30).map((a) => `${a.id} ${a.title}: ${a.episodes}/${a.expectedEpisodes}`),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  console.log(`\n## ${p.name}\n${JSON.stringify(summary, null, 2)}`);
  report[p.id] = { summary, programs: audits };
}
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
