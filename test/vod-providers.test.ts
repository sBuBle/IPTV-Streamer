import { describe, expect, it } from "vitest";
import { silentLogger } from "../src/logger.js";
import { I24NewsAdapter } from "../src/providers/i24news/index.js";
import { heroVideo, KanAdapter, parseLobby, parsePlayerConfig, programFromPage } from "../src/providers/kan/index.js";
import { KnessetAdapter } from "../src/providers/knesset/index.js";
import { episodeIdFromHref, episodeManifest } from "../src/providers/knesset/vod.js";
import { buildProviders } from "../src/providers/index.js";
import { MakoAdapter, parseExtraInfo } from "../src/providers/mako/index.js";
import { assignEpisodeNumbers, parseClock, parseDayFirstDate } from "../src/providers/vod-util.js";
import { fakeFetch, testConfig } from "./helpers.js";

// Fixtures below are trimmed copies of the real pages (read 25 Oct 2026), keeping the markup the parsers rely on.

function ctxFor(routes: Parameters<typeof fakeFetch>[0], env: Record<string, string> = {}) {
  const config = testConfig(env);
  const f = fakeFetch(routes);
  return { config, calls: f.calls, ctx: { fetch: f.fetch, logger: silentLogger, config, signal: new AbortController().signal } };
}

const html = (body: string) => () => new Response(body, { headers: { "content-type": "text/html" } });
const json = (body: unknown) => () => Response.json(body);

describe("VOD helpers", () => {
  it("parses clocks, Israeli dates and numbers episodes without collisions", () => {
    expect(parseClock("00:51:46")).toBe(3106);
    expect(parseClock("06:44")).toBe(404);
    expect(parseClock("00:00:00")).toBeUndefined();
    expect(parseDayFirstDate("24.10.26")).toBe("2026-10-24T00:00:00.000Z");
    expect(parseDayFirstDate("10/01/2026 22:00")).toBe("2026-01-10T00:00:00.000Z");
    const numbered = assignEpisodeNumbers([{ n: 2 }, { n: undefined }, { n: 2 }, { n: 1 }], (x) => x.n).map((x) => x.episode);
    expect(numbered).toEqual([2, 3, 4, 1]);
  });
});

const KAN_LOBBY = `
<h2 role="heading">חדש מהקופסה</h2>
<a class="cr-item unstyled-link" href="https://www.kan.org.il/content/kan/kan-11/p-12832/" aria-label="קופה ראשית">
  <img src="/media/5iff/poster-image-big_1200x1800_kupa.jpg?width=300&amp;height=450&amp;v=1" alt="קופה ראשית" />
  <p class="cr-subtitle max-lines-3">סדרה מוקומנטרית על סניף סופרמרקט</p></a>
<a href="https://www.kan.org.il/content/kan/kan-reka/p-10861/" class="nav-link">English</a>
<h2>קומדיה וסאטירה</h2>
<a class="cr-item" href="https://www.kan.org.il/content/kan/kan-11/p-12832/" aria-label="קופה ראשית"><img src="/media/x.jpg" /></a>
<h2>סרטי דוקו</h2>
<a class="cr-item" href="https://www.kan.org.il/content/dig/digital/p-11297/" aria-label="סרט תיעודי"><img src="/media/doc.jpg" /></a>`;

const KAN_PROGRAM = `
<meta property="og:title" content="קופה ראשית" />
<meta property="og:description" content="&lt;p&gt;סדרה מוקומנטרית&lt;/p&gt;" />
<div class="block-img hero-vod-img" style="background-image: url(/media/hero.jpg?width=1920)"></div>
<div class="info-genre hero-vod-meta"><ul><li>קומדיה</li><li>עונה 6</li></ul></div>
<a href="https://www.kan.org.il/content/kan/kan-11/p-12832/s6/1098375/" class="hero-vod-cta">לצפייה</a>
<section class="program-seasons" data-program-seasons>
  <a class="program-season-tab is-active" href="https://www.kan.org.il/content/kan/kan-11/p-12832/s6/">עונה 6</a>
  <a class="program-season-tab" href="https://www.kan.org.il/content/kan/kan-11/p-12832/s1/">עונה 1</a>
</section>
<div id="program-episodes" class="program-episodes" data-season-id="1098481">
  <a class="cr-item" href="https://www.kan.org.il/content/kan/kan-11/p-12832/s6/1098375/" aria-label="פרק 5">
    <img src="/media/ep5.jpg?width=490&amp;height=272" /><h3 class="cr-title">פרק 5 - שמור לי תור</h3><p class="cr-subtitle">עונה 6, פרק 5</p></a>
  <a class="cr-item" href="https://www.kan.org.il/content/kan/kan-11/p-12832/s6/1098001/" aria-label="פרק 4">
    <img src="/media/ep4.jpg" /><h3 class="cr-title">פרק 4</h3></a>
</div>
<a class="cr-item" href="https://www.kan.org.il/content/kan/kan-11/p-99999/s1/5/"><img src="/media/other.jpg" /><h3>תוכנית אחרת</h3></a>`;

const KAN_SEASON_1 = `
<a class="program-season-tab" href="https://www.kan.org.il/content/kan/kan-11/p-12832/s6/">עונה 6</a>
<a class="program-season-tab is-active" href="https://www.kan.org.il/content/kan/kan-11/p-12832/s1/">עונה 1</a>
<div id="program-episodes"><a class="cr-item" href="https://www.kan.org.il/content/kan/kan-11/p-12832/s1/89248/"><img src="/media/s1e1.jpg" /><h3 class="cr-title">פרק 1 - שלי מהבית</h3></a></div>`;

const KAN_EPISODE = (drm = "null") => `
<script>var x = 1;</script>
<div id="redge-player-1098375"></div>
<script>window.cfg = {"containerId":"redge-player-1098375","id":"1098375","isLive":false,"meta":{"title":"\\u05E4\\u05E8\\u05E7 5"},"file":{"dash":"//r.il.cdn-redge.media/webcache/gorigin/dash/oil/kancdn/vod/1/Manifest.ism","hls":"//r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/1/Manifest.ism/playlist.m3u8?fmp4"},"drm":{"widevine":${drm},"fairplay":{"src":null,"cert":null}}};</script>`;

describe("Kan VOD", () => {
  it("reads programs, genres and films from lobby sections", () => {
    const programs = parseLobby(KAN_LOBBY);
    expect(programs.map((p) => [p.id, p.kind, p.genres])).toEqual([
      ["12832", "series", ["Comedy"]],
      ["11297", "movie", ["Documentary"]],
    ]);
    expect(programs[0]).toMatchObject({ title: "קופה ראשית", geo: "israel-only", description: "סדרה מוקומנטרית על סניף סופרמרקט" });
    expect(programs[0]!.poster).toBe("https://www.kan.org.il/media/5iff/poster-image-big_1200x1800_kupa.jpg?width=600&height=900&v=1");
  });

  it("collects every season from the season pages and resolves Israel-only HLS and DASH", async () => {
    const { ctx } = ctxFor(
      {
        "https://www.kan.org.il/lobby/kan-box/": html(KAN_LOBBY),
        "https://www.kan.org.il/content/kan/kan-11/p-12832/s1/89248/": html(KAN_EPISODE()),
        "https://www.kan.org.il/content/kan/kan-11/p-12832/s6/1098375/": html(KAN_EPISODE('"https://drm.example/license"')),
        "https://www.kan.org.il/content/kan/kan-11/p-12832/s1/": html(KAN_SEASON_1),
        "https://www.kan.org.il/content/kan/kan-11/p-12832/": html(KAN_PROGRAM),
      },
      { KAN_LOBBIES: "https://www.kan.org.il/lobby/kan-box/" },
    );
    const kan = new KanAdapter(ctx.config.providers.kan);
    const detail = await kan.vod.getProgram("12832", ctx);
    expect(detail?.episodes.map((e) => [e.id, e.season, e.episode, e.title])).toEqual([
      ["1-89248", 1, 1, "פרק 1 - שלי מהבית"],
      ["6-1098001", 6, 4, "פרק 4"],
      ["6-1098375", 6, 5, "פרק 5 - שמור לי תור"],
    ]);
    expect(detail?.episodes[2]!.description).toBeUndefined();
    expect(detail?.background).toBe("https://www.kan.org.il/media/hero.jpg?width=1920");

    const streams = await kan.vod.resolveEpisodeStreams("12832", "1-89248", ctx);
    expect(streams.map((s) => [s.format, s.url, s.geo])).toEqual([
      ["hls", "https://r.il.cdn-redge.media/webcache/gorigin/hls/oil/kancdn/vod/1/Manifest.ism/playlist.m3u8?fmp4", "israel-only"],
      ["dash", "https://r.il.cdn-redge.media/webcache/gorigin/dash/oil/kancdn/vod/1/Manifest.ism", "israel-only"],
    ]);
    // DRM-protected episodes are skipped, never offered.
    expect(await kan.vod.resolveEpisodeStreams("12832", "6-1098375", ctx)).toEqual([]);
  });

  it("leaves radio and podcasts out of the lobbies and marks films from the films lobby", () => {
    const lobby = `<h2>הכי חדש</h2>
<a class="cr-item" href="https://www.kan.org.il/content/kan/podcasts/p-1/" aria-label="הסכת"><img src="/media/p.jpg" /></a>
<a class="cr-item" href="https://www.kan.org.il/content/kan/kan-b/p-2/" aria-label="רדיו"><img src="/media/r.jpg" /></a>
<a class="cr-item" href="https://www.kan.org.il/content/kan/kan-11/p-3/" aria-label="סרט"><img src="/media/f.jpg" /></a>`;
    expect(parseLobby(lobby, "https://www.kan.org.il/lobby/%D7%A1%D7%A8%D7%98%D7%99%D7%9D/").map((p) => [p.id, p.kind])).toEqual([["3", "movie"]]);
    expect(parseLobby(lobby, "https://www.kan.org.il/lobby/kan-box/").map((p) => [p.id, p.kind])).toEqual([["3", "series"]]);
  });

  it("loads the older seasons that the old program layout hides behind 'load more', and named sub-sections", async () => {
    const P = "https://www.kan.org.il/content/kan/kan-11/p-11486/";
    const card = (path: string, title: string) => `<li><a href="${P}${path}" class="program-grid-card unstyled-link" aria-label="${title}"><img src="/media/x.jpg" /><h3 class="program-grid-title">${title}</h3></a></li>`;
    const season = (id: string, first: boolean, cards: string[]) => `<div class="seasons-item" data-season-id="${id}" data-is-first-season="${first}"><ul class="program-grid">${cards.join("")}</ul></div>`;
    const page = (seasons: string) => `<a href="${P}s11/1100316/" class="hero-vod-cta">לצפייה</a><div class="vod-new-wrapper"><div class="seasons">${seasons}</div><div id="vod-page-items-show-more"></div><button class="btn show-more" id="vod-program-show-more" type="button">טען עוד</button></div>`;
    const { ctx, calls } = ctxFor(
      {
        [`${P}?page=2&itemsToShow=500&lastLoadedSeasonId=974774`]: html(page(season("815134", false, [card("s9/900001/", "פרק 1 - א"), card("s9/900002/", "פרק 2 - ב")]))),
        [`${P}?page=3&itemsToShow=500&lastLoadedSeasonId=815134`]: html(page(season("700000", true, [card("new_chefs/800001/", "שפים חדשים 1")]))),
        [P]: html(page(season("1100304", false, [card("s11/1100316/", "פרק 1 - ג")]) + season("974774", false, [card("s10/1085339/", "פרק 1 - ד")]))),
        "https://www.kan.org.il/lobby/kan-box/": html(`<h2>אירוח</h2><a class="cr-item" href="${P}" aria-label="פגישה עם רוני קובן"><img src="/media/k.jpg" /></a>`),
      },
      { KAN_LOBBIES: "https://www.kan.org.il/lobby/kan-box/" },
    );
    const kan = new KanAdapter(ctx.config.providers.kan);
    const d = await kan.vod.getProgram("11486", ctx);
    expect(d?.episodes.map((e) => [e.id, e.season, e.episode])).toEqual([
      ["9-900001", 9, 1],
      ["9-900002", 9, 2],
      ["10-1085339", 10, 1],
      ["11-1100316", 11, 1],
      ["new_chefs-800001", 12, 1],
    ]);
    expect(d?.seasonNames).toEqual({ 12: "new chefs" });
    await kan.vod.resolveEpisodeStreams("11486", "new_chefs-800001", ctx);
    expect(calls.at(-1)?.url).toBe(`${P}new_chefs/800001/`);
  });

  it("reads programs that no lobby lists from the sitemap", async () => {
    const root = (path: string) => `<url><loc>https://www.kan.org.il/content/${path}</loc></url>`;
    const film = `<meta property="og:title" content="חלומו של אבידן | לצפייה" /><meta property="og:image" content="/media/avidan.jpg" />
<script>npawData.program = decodeEntities('חלומו של אבידן');</script><a href="https://www.kan.org.il/content/kan/kan-11/p-978325/978326/" class="hero-vod-cta">לצפייה</a>`;
    const { ctx } = ctxFor(
      {
        "https://www.kan.org.il/media/sitemap/general/siteindex.xml": html(`<sitemapindex><sitemap><loc>https://www.kan.org.il/media/sitemap/general/sitemap0.xml</loc></sitemap></sitemapindex>`),
        "https://www.kan.org.il/media/sitemap/general/sitemap0.xml": html(
          `<urlset>${["kan/kan-11/p-978325/", "kan/kan-11/p-978325/978326/", "kan/kan-b/p-5/", "kan/kan-b/p-5/6/", "kan/kan-11/p-12832/", "kan/kan-11/p-12832/s1/1/"].map(root).join("")}</urlset>`,
        ),
        "https://www.kan.org.il/content/kan/kan-11/p-978325/": html(film),
        "https://www.kan.org.il/content/kan/kan-11/p-12832/s1/": html(KAN_SEASON_1),
        "https://www.kan.org.il/content/kan/kan-11/p-12832/": html(KAN_PROGRAM),
        "https://www.kan.org.il/lobby/kan-box/": html(KAN_LOBBY),
      },
      { KAN_LOBBIES: "https://www.kan.org.il/lobby/kan-box/", KAN_SITEMAP: "https://www.kan.org.il/media/sitemap/general/siteindex.xml" },
    );
    const kan = new KanAdapter(ctx.config.providers.kan);
    await kan.vod.listPrograms(ctx);
    await kan.discoverFromSitemap(ctx);
    const programs = await kan.vod.listPrograms(ctx);
    expect(programs.find((p) => p.id === "978325")).toMatchObject({ title: "חלומו של אבידן", kind: "movie", poster: "https://www.kan.org.il/media/avidan.jpg" });
    expect(programs.some((p) => p.id === "5")).toBe(false); // radio
    // An episode only the sitemap knows (Kan's pages cut long seasons at 50) joins its season, titled by number.
    const detail = await kan.vod.getProgram("12832", ctx);
    expect(detail?.episodes.find((e) => e.id === "1-1")).toMatchObject({ season: 1, title: "פרק 2" });
    expect(programFromPage("<html>no video</html>", "1", "https://www.kan.org.il/content/kan/kan-11/p-1/")).toBeUndefined();
  });

  it("uses the hero 'watch' video for programs that are a single video", () => {
    const page = `<a href="https://www.kan.org.il/content/kan/kan-11/p-1042052/1042053/" class="hero-vod-cta">לצפייה</a>`;
    expect(heroVideo(page, "1042052")).toEqual({ segment: "", kanId: "1042053" });
    expect(heroVideo(page, "999")).toBeUndefined();
  });

  it("finds the player config even with braces inside strings", () => {
    expect(parsePlayerConfig(`{"containerId":"redge-player-1","meta":{"title":"a } b"},"file":{"hls":"//x/y.m3u8"}}`)?.file?.hls).toBe("//x/y.m3u8");
    expect(parsePlayerConfig("<html>no player</html>")).toBeUndefined();
  });
});

const KNESSET_SHOWS = `
<a href="/tv-shows/the-scale/" target="_self"><span> לצפייה </span><img src="/HTML/img/arrow-left.svg"></a>
<div class="vertical-card"><a href="/tv-shows/the-scale/"><img src="/media/30134/scale.png" alt="המדד עם רועי כ&quot;ץ" loading="lazy"></a></div>
<div class="vertical-card"><a href="/tv-shows/88938/"><img src="/media/33977/split.png" alt="פירוק והרכבה" loading="lazy"></a></div>`;

const knessetShowPage = (ids: number[], next?: string) => `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"TVSeries","name":"המדד עם רועי כ\\"ץ","description":"המגזין הכלכלי של ערוץ כנסת","image":"https://www.knesset.tv/media/33657/banner.png"}</script>
<div class="horizontal-simple-list" id="episodes-block">
${ids.map((id, i) => `<div class="horizontal-card"><a href="/tv-shows/the-scale/video/${id}/"><img src="/media/cover.png" alt="x"><div class="detail-dis"><h2>המדד ${i}</h2><span>${id - 90}.01.26 22:00</span></div></a></div>`).join("\n")}
</div>
${next ? `<a class="btn btn-loading mb-4" id="showMoreEpisodeBtn"\n href="${next}" style="display: inline;">טען עוד</a>` : ""}`;

describe("Knesset VOD", () => {
  it("maps episode links to ids and back", () => {
    expect(episodeIdFromHref("the-scale", "/tv-shows/the-scale/video/89510/")).toBe("video_89510");
    expect(episodeIdFromHref("39011", "/tv-shows/39011/39012/45965/")).toBe("39012_45965");
    expect(episodeIdFromHref("39011", "/tv-shows/other/video/1/")).toBeUndefined();
  });

  it("prefers the episode's own manifest over the live player on the page", () => {
    const page = `<div data-video-url="https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/playlist.m3u8"></div>
      <iframe src="https://watch.knesset.tv?src=https://api.bynetcdn.com/Redirector/knesset/manifest/KNS028370/HLS/playlist.m3u8?tn=&amp;ts=1768501538&amp;&live=false"></iframe>`;
    expect(episodeManifest(page, "https://www.knesset.tv/tv-shows/88938/video/88941/")).toMatch(/^https:\/\/api\.bynetcdn\.com\/Redirector\/knesset\/manifest\/KNS028370\/HLS\/playlist\.m3u8/);
  });

  it("lists shows, follows 'load more' pages and resolves episodes", async () => {
    const { ctx } = ctxFor(
      {
        "https://www.knesset.tv/tv-shows/the-scale/video/101/": html(`<iframe src="https://watch.knesset.tv?src=https://api.bynetcdn.com/Redirector/knesset/manifest/KNS1/HLS/playlist.m3u8?tn=&amp;ts=1&amp;&live=false">`),
        "https://www.knesset.tv/tv-shows/the-scale/?page=1": html(knessetShowPage([101, 102])),
        "https://www.knesset.tv/tv-shows/the-scale/": html(knessetShowPage([104, 103], "https://www.knesset.tv/tv-shows/the-scale/?page=1")),
        "https://www.knesset.tv/tv-shows/": html(KNESSET_SHOWS),
      },
      { KNESSET_VOD_PAGES: "https://www.knesset.tv/tv-shows/" },
    );
    const k = new KnessetAdapter(ctx.config.providers.knesset);
    const programs = await k.vod!.listPrograms(ctx);
    expect(programs.map((p) => [p.id, p.title])).toEqual([
      ["the-scale", 'המדד עם רועי כ"ץ'],
      ["88938", "פירוק והרכבה"],
    ]);
    const detail = await k.vod!.getProgram("the-scale", ctx);
    expect(detail?.episodes.map((e) => e.id)).toEqual(["video_101", "video_102", "video_103", "video_104"]);
    expect(detail?.description).toBe("המגזין הכלכלי של ערוץ כנסת");
    const streams = await k.vod!.resolveEpisodeStreams("the-scale", "video_101", ctx);
    expect(streams[0]?.url).toMatch(/^https:\/\/api\.bynetcdn\.com\/Redirector\/knesset\/manifest\/KNS1\/HLS\/playlist\.m3u8/);
  });
  it("pages through long shows in batches and adds older shows from the sitemap", async () => {
    const S = "https://www.knesset.tv/tv-shows/the-scale/";
    // Routes match by prefix, first match wins: longer URLs go first.
    const routes: Record<string, ReturnType<typeof html>> = {};
    // 25 pages of 2 episodes each; the last page has no "load more" link.
    for (let n = 24; n >= 1; n--) routes[`${S}?page=${n}`] = html(knessetShowPage([1000 + 2 * n, 1001 + 2 * n], n < 24 ? `${S}?page=${n + 1}` : undefined));
    routes[S] = html(knessetShowPage([998, 999], `${S}?page=1`));
    routes["https://www.knesset.tv/sitemap/sitemap-standard-1.xml"] = html(`<urlset><url><loc>https://www.knesset.tv/tv-shows/knesset-square/</loc></url><url><loc>${S}</loc></url></urlset>`);
    routes["https://www.knesset.tv/tv-shows/knesset-square/"] = html(
      `<script type="application/ld+json">{"@type":"TVSeries","name":"כיכר הכנסת"}</script><div id="episodes-block"><a href="/tv-shows/knesset-square/video/5/"><h2>כיכר</h2></a></div>`,
    );
    routes["https://www.knesset.tv/tv-shows/"] = html(KNESSET_SHOWS);
    const { ctx } = ctxFor(routes, { KNESSET_VOD_PAGES: "https://www.knesset.tv/tv-shows/", KNESSET_VOD_SITEMAP: "https://www.knesset.tv/sitemap/sitemap-standard-1.xml" });
    const k = new KnessetAdapter(ctx.config.providers.knesset);
    const d = await k.vod!.getProgram("the-scale", ctx);
    expect(d?.episodes.length).toBe(50);
    await k.vod!.listPrograms(ctx);
    await (k.vod as unknown as { discoverFromSitemap(c: typeof ctx): Promise<void> }).discoverFromSitemap(ctx);
    const programs = await k.vod!.listPrograms(ctx);
    expect(programs.map((p) => p.id)).toEqual(["the-scale", "88938", "knesset-square"]);
    expect(programs[2]!.title).toBe("כיכר הכנסת");
  });
});

describe("i24NEWS VOD", () => {
  const API = "https://insight-api-shared.univtec.com/interface";
  const episode = (id: string, date: number, extra: Record<string, unknown> = {}) => ({
    id,
    title: `THE RUNDOWN ${id}`,
    videoUrl: `https://i24israel.vod.immergo.tv/i24israel/transcoded/${id}/hls/master.m3u8`,
    date,
    duration: "00:51:46",
    commerceType: "free",
    ...extra,
  });

  it("turns monthly seasons into numbered seasons, oldest first, and skips paid or unplayable items", async () => {
    const { ctx } = ctxFor(
      {
        [`${API}/pages/series/show1`]: json({
          id: "show1",
          title: "THE RUNDOWN",
          description: "News\\\n",
          seasons: [
            { title: "October 2026", episodes: [episode("e3", 3000), episode("e4", 4000, { commerceType: "paid" })] },
            { title: "September 2026", episodes: [episode("e2", 2000), episode("e1", 1000), episode("e0", 500, { videoUrl: null })] },
          ],
        }),
        [`${API}/pages/vod/e3`]: json([episode("e3", 3000)]),
        [`${API}/pages/`]: json({ sections: [{ items: [{ id: "show1", entity: "series", title: "THE RUNDOWN", image: "https://img/x.jpg", dateUpdate: 5 }] }] }),
      },
      { I24_PAGES: "all:home" },
    );
    const i24 = new I24NewsAdapter(ctx.config.providers.i24news);
    expect((await i24.vod.listPrograms(ctx)).map((p) => [p.id, p.language])).toEqual([["show1", "en"]]);
    const d = await i24.vod.getProgram("show1", ctx);
    expect(d?.episodes.map((e) => [e.id, e.season, e.episode])).toEqual([
      ["e1", 1, 1],
      ["e2", 1, 2],
      ["e3", 2, 1],
    ]);
    expect(d?.seasonNames).toEqual({ 1: "September 2026", 2: "October 2026" });
    expect(d?.episodes[0]!.durationSec).toBe(3106);
    expect(d?.description).toBe("News");
    const s = await i24.vod.resolveEpisodeStreams("show1", "e3", ctx);
    expect(s[0]?.url).toBe("https://i24israel.vod.immergo.tv/i24israel/transcoded/e3/hls/master.m3u8");
  });
});

describe("Mako catalog", () => {
  it("is off unless asked for", () => {
    expect(buildProviders(testConfig()).map((p) => p.id)).toEqual(["i24news", "knesset", "kan"]);
    expect(buildProviders(testConfig({ MAKO_VOD: "catalog" })).map((p) => p.id)).toContain("mako");
    expect(new MakoAdapter(testConfig().providers.mako).issues()[0]?.severity).toBe("error");
  });

  it("parses episode info and links out instead of streaming", async () => {
    expect(parseExtraInfo("עונה 5@פרק 3@24.10.26")).toEqual({ episode: 3, released: "2026-10-24T00:00:00.000Z" });
    const season = (n: number, vods: unknown[]) => ({
      pageUrl: `/mako-vod-keshet/show-s${n}`,
      seo: { schema: { name: "הזמר במסכה", description: "ריאליטי", image: "https://img.mako.co.il/p.jpg" } },
      seasons: [
        { seasonTitle: "עונה 4", pageUrl: "/mako-vod-keshet/show-s4" },
        { seasonTitle: "עונה 5", pageUrl: "/mako-vod-keshet/show-s5", current: true },
      ],
      menu: [{ id: "allEpisodes", vods }],
    });
    const vod = (id: string, ep: number) => ({ title: `ep ${ep}`, pageUrl: `/mako-vod-keshet/show-s5/VOD-${id}.htm`, extraInfo: `פרק ${ep}@2${ep}.10.26`, aINT: false, aIL: true });
    const { ctx } = ctxFor(
      {
        "https://www.mako.co.il/mako-vod-keshet/show-s4?platform=responsive": json(season(4, [vod("bbb", 1)])),
        "https://www.mako.co.il/mako-vod-keshet/show?platform=responsive": json(season(5, [vod("ddd", 2), vod("ccc", 1)])),
        "https://www.mako.co.il/mako-vod-index?platform=responsive": json({ items: [{ title: "הזמר במסכה", pageUrl: "/mako-vod-keshet/show", pic: "https://img/p.jpg" }] }),
      },
      { MAKO_VOD: "catalog" },
    );
    const mako = new MakoAdapter(ctx.config.providers.mako);
    expect(mako.issues()).toEqual([]);
    expect((await mako.vod.listPrograms(ctx)).map((p) => p.id)).toEqual(["show"]);
    const d = await mako.vod.getProgram("show", ctx);
    expect(d?.episodes.map((e) => [e.id, e.season, e.episode])).toEqual([
      ["4-bbb", 4, 1],
      ["5-ccc", 5, 1],
      ["5-ddd", 5, 2],
    ]);
    expect(d?.geo).toBe("israel-only");
    expect(await mako.vod.resolveEpisodeStreams("show", "5-ddd", ctx)).toEqual([
      { url: "https://www.mako.co.il/mako-vod-keshet/show-s5/VOD-ddd.htm", format: "external", label: "mako.co.il", source: "mako-catalog", geo: "israel-only" },
    ]);
  });
  it("reports Mako's bot-protection block page instead of a JSON error", async () => {
    const { ctx } = ctxFor(
      {
        "https://www.mako.co.il/mako-vod-keshet/show?platform=responsive": html("<!DOCTYPE html><title>Radware Block Page</title>"),
        "https://www.mako.co.il/mako-vod-index?platform=responsive": json({ items: [{ title: "x", pageUrl: "/mako-vod-keshet/show" }] }),
      },
      { MAKO_VOD: "catalog" },
    );
    const mako = new MakoAdapter(ctx.config.providers.mako);
    await mako.vod.listPrograms(ctx);
    await expect(mako.vod.getProgram("show", ctx)).rejects.toThrow(/bot protection/);
  });
});
