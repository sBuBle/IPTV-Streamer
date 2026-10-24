import { buildAddon } from "../bootstrap.js";
import { loadConfig, type Env } from "../config.js";
import { createLogger } from "../logger.js";
import { d1Driver } from "../storage/d1.js";
import { MemoryStore } from "../storage/memory.js";
import { SqlStore } from "../storage/sql.js";
import type { Store } from "../storage/types.js";

interface WorkerEnv extends Record<string, unknown> {
  DB?: D1Database;
}

type Addon = ReturnType<typeof buildAddon> & { store: Store };
let addon: Promise<Addon> | undefined;

/** One add-on instance per isolate, so caches survive between requests. */
function getAddon(env: WorkerEnv): Promise<Addon> {
  addon ??= (async () => {
    const vars: Env = {};
    for (const [k, v] of Object.entries(env)) if (typeof v === "string") vars[k] = v;
    const config = loadConfig(vars);
    const logger = createLogger(config.logLevel, { service: "israeli-tv-addon", runtime: "workers" });
    const store: Store = env.DB ? new SqlStore(d1Driver(env.DB)) : new MemoryStore();
    if (!env.DB) logger.warn("no D1 binding named DB; checks are kept in memory only");
    await store.init();
    return { ...buildAddon({ config, logger, store }), store };
  })().catch((err) => {
    addon = undefined;
    throw err;
  });
  return addon;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const { app } = await getAddon(env);
    return app.fetch(request, env, ctx);
  },

  /** Cron trigger: health probes from Cloudflare's network. Probes never mark streams verified. */
  async scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const { service, store } = await getAddon(env);
    ctx.waitUntil(
      service.probeAll(typeof env.VERIFIER_LOCATION === "string" ? env.VERIFIER_LOCATION : "cloudflare").then(() =>
        store.prune(Date.now() - 30 * 86400_000),
      ),
    );
  },
};
