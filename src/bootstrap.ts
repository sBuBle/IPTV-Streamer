import { createApp } from "./app.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import { buildProviders } from "./providers/index.js";
import { ProviderRegistry } from "./providers/registry.js";
import type { ProviderAdapter } from "./providers/types.js";
import type { Store } from "./storage/types.js";
import type { FetchFn } from "./util/http.js";

export const VERSION = "0.1.0";

export function buildAddon(opts: { config: Config; logger: Logger; store: Store; fetch?: FetchFn; providers?: ProviderAdapter[]; now?: () => number }) {
  const providers = opts.providers ?? buildProviders(opts.config);
  const registry = new ProviderRegistry(providers, { config: opts.config, logger: opts.logger, fetch: opts.fetch, now: opts.now });
  return { registry, ...createApp({ ...opts, registry, version: VERSION }) };
}
