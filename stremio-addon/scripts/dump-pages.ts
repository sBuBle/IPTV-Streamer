/** Prints the parts of broadcaster pages and scripts that mention players or manifests. Diagnostic only. */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "https://www.i24news.tv/en/tv/live",
      "https://www.i24news.tv/he/tv/live",
      "https://www.i24news.tv/en",
      "https://main.knesset.gov.il/news/broadcast/pages/live.aspx",
      "https://main.knesset.gov.il/",
      "https://www.knesset.tv/",
      "https://knesset.tv/",
    ];
const NEEDLE = /m3u8|mpd|brightcove|data-account|data-video|videoId|policyKey|gostreaming|player|live/gi;

for (const url of PAGES) {
  console.log(`\n######## ${url}`);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    console.log(`HTTP ${res.status} final=${res.url} bytes=${text.length}`);
    const scripts = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
    console.log(`scripts: ${scripts.slice(0, 40).join(" ")}`);
    const iframes = [...text.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
    console.log(`iframes: ${iframes.join(" ")}`);
    const seen = new Set<string>();
    let n = 0;
    for (const m of text.matchAll(NEEDLE)) {
      const start = Math.max(0, m.index! - 150);
      const snippet = text.slice(start, m.index! + 200).replace(/\s+/g, " ");
      const key = snippet.slice(100, 220);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  …${snippet}…`);
      if (++n >= 40) break;
    }
  } catch (err) {
    console.log(`failed: ${(err as Error).message}`);
  }
}
