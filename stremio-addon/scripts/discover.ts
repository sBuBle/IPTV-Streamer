/**
 * Discovery helper. Fetches broadcaster pages from the machine it runs on and prints what a player on
 * that page would use: manifest URLs, Brightcove account/player/video ids and policy keys.
 * Copy the values into .env (see .env.example). Nothing is written automatically.
 *
 *   npm run discover                 # default candidate pages
 *   npm run discover -- <url> <url>  # your own pages
 */
import { extractManifestUrls } from "../src/media/extract.js";
import { extractPolicyKey } from "../src/providers/i24news/brightcove.js";

// Candidate pages; they may move. Pass real page URLs as arguments if these 404.
const DEFAULT_PAGES = [
  "https://www.i24news.tv/en/tv/live",
  "https://www.i24news.tv/fr/tv/live",
  "https://www.i24news.tv/ar/tv/live",
  "https://www.i24news.tv/he/tv/live",
  "https://main.knesset.gov.il/news/broadcast/pages/live.aspx",
  "https://www.knesset.tv/",
];

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const pages = process.argv.slice(2).filter((a) => a.startsWith("http"));

async function get(url: string): Promise<{ status: number; text: string; finalUrl: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  return { status: res.status, text: await res.text(), finalUrl: res.url };
}

function brightcoveIds(html: string) {
  const attr = (name: string) => [...html.matchAll(new RegExp(`${name}\\s*[=:]\\s*["']?([A-Za-z0-9_-]+)`, "gi"))].map((m) => m[1]!);
  const players = [...html.matchAll(/players\.brightcove\.net\/(\d+)\/([A-Za-z0-9_-]+)_default/g)].map((m) => ({ account: m[1]!, player: m[2]! }));
  return {
    accounts: [...new Set([...attr("data-account"), ...attr("accountId"), ...players.map((p) => p.account)])],
    players: [...new Set([...attr("data-player"), ...attr("playerId"), ...players.map((p) => p.player)])],
    videoIds: [...new Set([...attr("data-video-id"), ...attr("videoId")])],
  };
}

for (const url of pages.length ? pages : DEFAULT_PAGES) {
  console.log(`\n=== ${url}`);
  try {
    const page = await get(url);
    console.log(`HTTP ${page.status}, ${page.text.length} bytes${page.finalUrl !== url ? `, redirected to ${page.finalUrl}` : ""}`);
    const manifests = extractManifestUrls(page.text, page.finalUrl);
    console.log(manifests.length ? `Manifest URLs:\n  ${manifests.join("\n  ")}` : "No manifest URLs in the page HTML (the player may load them from a script or API).");
    const bc = brightcoveIds(page.text);
    if (bc.accounts.length || bc.players.length || bc.videoIds.length) {
      console.log(`Brightcove: accounts=${bc.accounts.join(",") || "-"} players=${bc.players.join(",") || "-"} videoIds=${bc.videoIds.join(",") || "-"}`);
      for (const account of bc.accounts) {
        for (const player of bc.players) {
          try {
            const js = await get(`https://players.brightcove.net/${account}/${player}_default/index.min.js`);
            const key = extractPolicyKey(js.text);
            console.log(`  player ${account}/${player}: ${key ? `policy key found (${key.slice(0, 12)}…), set I24_BRIGHTCOVE_PLAYER_ID=${player}` : `no policy key (HTTP ${js.status})`}`);
          } catch (err) {
            console.log(`  player ${account}/${player}: ${(err as Error).message}`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`Failed: ${(err as Error).message}`);
  }
}
