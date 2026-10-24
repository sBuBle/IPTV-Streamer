import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Logger } from "./logger.js";
import { namePoster } from "./routes/assets.js";
import { AddonService, type AddonDeps } from "./services/addon.js";
import { parseExtra } from "./stremio/extra.js";

const checkSchema = z.object({
  itemId: z.string().startsWith("iltv:"),
  provider: z.string().min(1),
  kind: z.enum(["probe", "playback"]),
  ok: z.boolean(),
  checkedAt: z.number().int().positive(),
  location: z.string().max(16).optional(),
  streamHost: z.string().max(255).optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  error: z.string().max(2000).optional(),
});

/** Strips ".json" from the last path segment and splits off Stremio's optional "extra" segment. */
function splitJsonPath(rest: string): { id: string; extra?: string } | undefined {
  if (!rest.endsWith(".json")) return undefined;
  const parts = rest.slice(0, -".json".length).split("/");
  const id = decodeURIComponent(parts[0] ?? "");
  if (!id) return undefined;
  return { id, extra: parts[1] };
}

/** Constant-time comparison of the bearer token. */
function isAuthorized(header: string | undefined, token: string): boolean {
  const expected = `Bearer ${token}`;
  const given = header ?? "";
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}

function cacheFor(c: Context, seconds: number) {
  c.header("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}, stale-if-error=86400`);
}

export function createApp(deps: AddonDeps & { service?: AddonService }) {
  const service = deps.service ?? new AddonService(deps);
  const { config, logger, store, registry } = deps;
  const app = new Hono<{ Variables: { log: Logger } }>();
  const baseUrl = (c: Context) => config.baseUrl ?? new URL(c.req.url).origin;

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "POST", "OPTIONS"] }));
  app.use("*", async (c, next) => {
    const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
    const log = logger.child({ requestId });
    c.set("log", log);
    const started = Date.now();
    await next();
    log.info("request", { method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started });
  });

  app.onError((err, c) => {
    c.get("log")?.error("unhandled error", { error: err, path: c.req.path }) ?? logger.error("unhandled error", { error: err });
    return c.json({ error: "internal_error" }, 500);
  });

  app.get("/", async (c) => {
    const manifestUrl = `${baseUrl(c)}/manifest.json`;
    const install = manifestUrl.replace(/^https?:\/\//, "stremio://");
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Israeli TV for Stremio</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}code{background:#eee;padding:.1rem .3rem;border-radius:4px;word-break:break-all}a.btn{display:inline-block;background:#6d28d9;color:#fff;padding:.6rem 1rem;border-radius:8px;text-decoration:none}</style></head>
<body><h1>Israeli TV for Stremio</h1><p><a class="btn" href="${install}">Install in Stremio</a></p>
<p>Or paste this URL into Stremio's add-on search: <code>${manifestUrl}</code></p>
<p><a href="/coverage">Coverage report</a> · <a href="/diagnostics">Diagnostics</a></p></body></html>`);
  });

  app.get("/manifest.json", async (c) => {
    cacheFor(c, 300);
    return c.json(await service.manifest());
  });

  app.get("/catalog/:type/:rest{.+}", async (c) => {
    const p = splitJsonPath(c.req.param("rest"));
    if (!p) return c.json({ metas: [] }, 404);
    cacheFor(c, 300);
    return c.json({ metas: await service.catalog(c.req.param("type"), p.id, parseExtra(p.extra && decodeURIComponent(p.extra)), baseUrl(c)) });
  });

  app.get("/meta/:type/:rest{.+}", async (c) => {
    const p = splitJsonPath(c.req.param("rest"));
    const meta = p && (await service.meta(c.req.param("type"), p.id, baseUrl(c)));
    if (!meta) return c.json({ meta: null }, 404);
    cacheFor(c, 300);
    return c.json({ meta });
  });

  app.get("/stream/:type/:rest{.+}", async (c) => {
    const p = splitJsonPath(c.req.param("rest"));
    if (!p) return c.json({ streams: [] }, 404);
    const streams = await service.streams(c.req.param("type"), p.id);
    // Signed URLs expire quickly, so stream lists are cached only briefly.
    cacheFor(c, streams.length ? 60 : 15);
    return c.json({ streams });
  });

  app.get("/assets/poster/:file{.+\\.svg}", async (c) => {
    const id = decodeURIComponent(c.req.param("file").slice(0, -".svg".length));
    const ch = await service.channel(id);
    if (!ch) return c.notFound();
    c.header("Content-Type", "image/svg+xml");
    cacheFor(c, 86400);
    return c.body(namePoster(ch.name, ch.stremioId));
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/diagnostics", async (c) => {
    const health = await service.healthByItem();
    return c.json({
      streamPolicy: config.streamPolicy,
      providers: registry.healthReport(),
      items: Object.fromEntries([...health].map(([id, h]) => [id, h])),
    });
  });

  app.get("/coverage", async (c) => {
    const channels = await service.channels();
    const health = await service.healthByItem();
    const providers = registry.healthReport().map((p) => {
      const mine = channels.filter((ch) => ch.provider === p.id);
      const count = (s: string) => mine.filter((ch) => health.get(ch.stremioId)?.status === s).length;
      const verified = count("verified");
      const lastCheck = Math.max(0, ...mine.flatMap((ch) => [health.get(ch.stremioId)?.lastProbe?.checkedAt ?? 0, health.get(ch.stremioId)?.lastPlayback?.checkedAt ?? 0]));
      return {
        provider: p.id,
        name: p.name,
        enabled: p.enabled,
        issues: p.issues.map((i) => i.message),
        liveChannelsDiscovered: mine.length,
        liveChannelsVerified: verified,
        liveChannelsReachableNotVerified: count("reachable"),
        liveChannelsFailing: count("failing"),
        liveChannelsUnchecked: count("unverified"),
        verifiedPlayableCoveragePct: mine.length ? Math.round((verified / mine.length) * 1000) / 10 : 0,
        vodProgramsDiscovered: 0,
        lastCheckAt: lastCheck ? new Date(lastCheck).toISOString() : null,
      };
    });
    return c.json({ generatedAt: new Date().toISOString(), providers });
  });

  app.post("/admin/checks", async (c) => {
    if (!config.adminToken) return c.json({ error: "admin_disabled" }, 404);
    if (!isAuthorized(c.req.header("authorization"), config.adminToken)) return c.json({ error: "unauthorized" }, 401);
    const parsed = z.array(checkSchema).max(500).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 10) }, 400);
    for (const check of parsed.data) await store.recordCheck(check);
    return c.json({ recorded: parsed.data.length });
  });

  app.post("/admin/probe", async (c) => {
    if (!config.adminToken) return c.json({ error: "admin_disabled" }, 404);
    if (!isAuthorized(c.req.header("authorization"), config.adminToken)) return c.json({ error: "unauthorized" }, 401);
    return c.json({ checks: await service.probeAll(config.verifierLocation) });
  });

  return { app, service };
}
