/** Diagnostic: finds how i24NEWS's player loads its live streams (page data and JS chunks). */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const get = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  return { status: res.status, url: res.url, text: await res.text(), type: res.headers.get("content-type") };
};
const NEEDLE = /univtec|insight-api|m3u8|\.mpd|playback|manifest|streamUrl|liveUrl|channelId|assetId|entitlement|playUrl|getPlay|\/live/gi;

function snippets(label: string, text: string, max = 30) {
  const seen = new Set<string>();
  let n = 0;
  for (const m of text.matchAll(NEEDLE)) {
    const snip = text.slice(Math.max(0, m.index! - 160), m.index! + 220).replace(/\s+/g, " ");
    const key = snip.slice(120, 260);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  [${label}] …${snip}…`);
    if (++n >= max) break;
  }
}

for (const page of ["https://video.i24news.tv/r/all/page/69f250bfaa852e43acd716b9", "https://video.i24news.tv/r/hebrew", "https://video.i24news.tv/"]) {
  console.log(`\n######## ${page}`);
  try {
    const p = await get(page);
    console.log(`HTTP ${p.status} ${p.url} ${p.text.length}`);
    const urls = [...new Set([...p.text.matchAll(/https?:\\?\/\\?\/[a-z0-9.-]+(?:univtec|immergo|i24)[a-z0-9.-]*[^"'\s\\]*/gi)].map((m) => m[0]))];
    console.log(`hosts/urls: ${urls.slice(0, 50).join("\n   ")}`);
    snippets("page", p.text, 40);
    if (page.includes("69f2")) {
      const chunks = [...new Set([...p.text.matchAll(/\/_next\/static\/chunks\/[^"'\s]+\.js/g)].map((m) => m[0]))];
      for (const c of chunks) {
        const js = await get(new URL(c, page).toString());
        if (/univtec|insight-api|m3u8|playback|manifest/i.test(js.text)) {
          console.log(`\n--- chunk ${c} (${js.text.length})`);
          snippets("js", js.text, 25);
        }
      }
    }
  } catch (err) {
    console.log(`failed: ${(err as Error).message}`);
  }
}
