import { serve } from "@hono/node-server";
import { buildAddon } from "../bootstrap.js";
import { ConfigError, loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openNodeSqlite } from "../storage/node-sqlite.js";
import { SqlStore } from "../storage/sql.js";

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }
  const logger = createLogger(config.logLevel, { service: "israeli-tv-addon" });
  const store = new SqlStore(openNodeSqlite(config.databasePath));
  await store.init();

  const { app, service } = buildAddon({ config, logger, store });
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) =>
    logger.info("listening", { port: info.port, manifest: `${config.baseUrl ?? `http://localhost:${info.port}`}/manifest.json` }),
  );

  // Loads channel and program lists before the first viewer asks, and again before they expire,
  // so Stremio rarely waits on a broadcaster. Failures are logged by the registry and never stop the server.
  const warm = () =>
    Promise.all([service.channels(), service.vod.allPrograms()])
      .then(([channels, programs]) => logger.info("caches warmed", { channels: channels.length, programs: programs.length }))
      .catch((err) => logger.error("cache warm-up failed", { error: err }));
  void warm();
  const warmTimer = setInterval(warm, 9 * 60_000);
  warmTimer.unref();

  let timer: NodeJS.Timeout | undefined;
  if (config.healthProbeIntervalMs > 0) {
    const run = () =>
      service
        .probeAll(config.verifierLocation)
        .then(() => store.prune(Date.now() - 30 * 86400_000))
        .catch((err) => logger.error("health probe pass failed", { error: err }));
    setTimeout(run, 5_000).unref();
    timer = setInterval(run, config.healthProbeIntervalMs);
    timer.unref();
  }

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    clearInterval(timer);
    clearInterval(warmTimer);
    server.close(() => {
      void store.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main();
