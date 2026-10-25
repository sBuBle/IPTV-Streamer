import type { Config } from "../config.js";
import { I24NewsAdapter } from "./i24news/index.js";
import { KanAdapter } from "./kan/index.js";
import { KnessetAdapter } from "./knesset/index.js";
import { MakoAdapter } from "./mako/index.js";
import type { ProviderAdapter } from "./types.js";

/** Every adapter the add-on knows about. Add new broadcasters here. */
export function buildProviders(config: Config): ProviderAdapter[] {
  return [
    new I24NewsAdapter(config.providers.i24news),
    new KnessetAdapter(config.providers.knesset),
    new KanAdapter(config.providers.kan),
    // Catalog only (links out to mako.co.il), so it is opt-in.
    ...(config.providers.mako.mode === "catalog" ? [new MakoAdapter(config.providers.mako)] : []),
  ];
}
