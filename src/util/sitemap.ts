import { decodeEntities } from "./html.js";

/** Every <loc> of a sitemap, following a sitemap index one level down. `get` fetches one URL as text. */
export async function sitemapLocs(url: string, get: (url: string) => Promise<string>): Promise<string[]> {
  const body = await get(url);
  const locs = [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decodeEntities(m[1]!));
  if (!/<sitemapindex[\s>]/i.test(body)) return locs;
  const out: string[] = [];
  for (const child of locs) for (const loc of [...(await get(child)).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]) out.push(decodeEntities(loc[1]!));
  return out;
}
