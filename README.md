# Israeli TV for Stremio

A Stremio add-on for Israeli live TV and VOD (series, seasons, episodes and films). It runs on Cloudflare Workers (free plan) or on any server with Node 22 or Docker.

The add-on only hands Stremio streams that come straight from each broadcaster. It does not proxy or relay video, and it does not work around DRM, logins or geo-blocking. Streams that only play in Israel are labeled as such.

## Status

| Area | State |
| --- | --- |
| Stremio manifest, catalog, meta, stream routes | Done, tested |
| Live TV catalog with genre filter, Hebrew/English search, paging | Done, tested |
| Provider adapters with failure isolation and timeouts | Done, tested |
| Storage: SQLite (Node) and D1 (Workers) | Done, tested |
| Playback verifier (real video and audio decode with ffprobe) | Done, tested against generated HLS |
| Health probes (scheduled), diagnostics, coverage report | Done |
| i24NEWS live: English, Français, عربي, עברית | **Verified** from the US on 24 Oct 2026 (H.264 360p to 1080p, AAC) |
| Knesset Channel live | **Verified** from the US on 24 Oct 2026 (H.264 720p, AAC) |
| i24NEWS VOD: every show on video.i24news.tv (English and French), all published episodes in monthly seasons | **Verified** from the US on 25 Oct 2026 on sample episodes (H.264 up to 1080p, AAC) |
| Knesset Channel VOD: TV shows from knesset.tv (about 50), newest 120 episodes per show | **Verified** from the US on 25 Oct 2026 on sample episodes (H.264 up to 720p, AAC) |
| Kan VOD: about 440 programs from kan.org.il (Kan Box and archive series), all seasons and episodes, films | Catalog and stream resolution work from abroad; **video is Israel-only** (Kan's CDN answers 403 outside Israel), so playback is not verified until it is checked from Israel |
| Mako (Keshet 12) VOD | Catalog only, off by default (`MAKO_VOD=catalog`). Playback needs Mako's per-viewer ticket from inside Israel; episodes link to mako.co.il instead |
| Reshet 13, Channel 14 | Not possible from abroad: their sites answer 403 outside Israel, so they need research from an Israeli host |

"Verified" means a real decode of video and audio, run by the `verify-streams` GitHub workflow from GitHub's US network. i24NEWS and Knesset work with no setup. The other Israeli broadcasters block viewers outside Israel, so they need a host in Israel for verification, and their streams only play for viewers in Israel.

## Quick start (Node)

```bash
npm install
cp .env.example .env      # optional; every setting has a default
npm run dev               # http://localhost:7000
```

Open `http://localhost:7000/` for the install link, or add `http://localhost:7000/manifest.json` in Stremio. Stremio needs HTTPS for anything other than localhost, so a remote install needs a domain with TLS or a Cloudflare Tunnel.

## Checking the channels

`npm run discover` lists what each provider finds from the machine it runs on (channels and stream URLs). `npm run verify -- --location IL` (use your real location) resolves each channel, probes it, decodes a few seconds of video and audio, and records the result in the add-on's database. `/coverage` then shows which channels count as working.

The `verify-streams` GitHub workflow does the same every day from GitHub's network. Set the repository variable `ADDON_URL` and secret `ADMIN_TOKEN` to push its results to your deployed add-on, so viewers see "✅ Playback verified".

A provider with broken settings is switched off and listed under `/diagnostics`. It never stops the rest of the add-on.

## VOD

Every VOD provider gets a series catalog ("Kan VOD", "i24NEWS VOD", "Knesset Channel VOD") with genre filter, Hebrew/English search and paging, and films from all providers share the "Israeli Movies & Documentaries" catalog. Opening a program lists its seasons and episodes; episode streams are resolved fresh from the broadcaster each time.

- **i24NEWS** groups episodes by month; season 1 is the oldest month still published. Shows are read from the region pages in `I24_PAGES`. i24's API serves only the last nine or so months of each show, even where it counts more episodes.
- **Knesset Channel** shows come from `KNESSET_VOD_PAGES`, plus older shows found in the site's sitemap (`KNESSET_VOD_SITEMAP`) that the show list no longer links to. Each show page lists 12 episodes; up to `KNESSET_VOD_MAX_PAGES` pages are read, three at a time (knesset.tv rate-limits more).
- **Kan** programs come from the lobby pages in `KAN_LOBBIES` (Kan Box, series, films, archive, sport, Judaism and more; radio and podcasts are left out), plus TV programs in Kan's sitemap (`KAN_SITEMAP`) that no lobby links to. The lobby section a program sits in gives its genres and tells films from series. Every season is read, including the older seasons that Kan's older program pages load with "load more", and named sub-sections become extra seasons. DRM-protected episodes are skipped.
- **Mako** is catalog only and off by default; see the status table. Mako's bot protection (Radware) blocks automated reading of program pages after the first requests. The add-on reports that as an error and does not try to get around it.

The sitemaps are read in the background once a day, so right after a start the catalogs hold the lobby programs only. That takes several hundred requests, more than a free Cloudflare Workers request may make, so `wrangler.toml` turns it off (`KAN_SITEMAP=none`, `KNESSET_VOD_SITEMAP=none`). Run the add-on on a normal server to get the full catalogs.

`npm run audit:vod` opens every program of every provider against the live sites and compares the counts with what the broadcasters publish (sitemaps, declared episode counts).

Episode numbers follow the broadcaster ("פרק 12") when it gives them, and otherwise the publishing order, so irregular numbering never collides.

Nobody can decode every episode, so the verifier decodes the newest episode of a few programs per provider (`npm run verify -- --vod 3`). An episode that was not checked itself shows the provider's sample result, for example "✅ Playback verified 2 h ago from US (sample of i24NEWS episodes)". Checks of Israel-only streams are skipped when the verifier runs outside Israel, because a failure there says nothing about viewers in Israel. With `STREAM_POLICY=verified-only`, a provider's VOD appears once a sample episode has decoded.

## What "verified" means

Each channel has one of four states, shown to viewers in the channel description and stream title:

- **verified**: a playback check decoded real video frames (and audio) within `VERIFIED_MAX_AGE_HOURS`. Only `npm run verify` writes these.
- **reachable**: a probe downloaded the playlist, a variant and a media segment that looks like video. That is not playback, so it is not "verified".
- **failing**: the newest check failed.
- **unverified**: no recent check.

An HTTP 200 or a valid playlist is never treated as proof of playback. With `STREAM_POLICY=verified-only`, Stremio only sees verified channels.

Checks record where they ran from (`--location`). A geo-blocked stream verified from Israel can still fail abroad.

## Deploy with Docker

```bash
cp .env.example .env
docker compose up -d --build
```

The image includes ffmpeg, so discovery and verification run inside the container and write to the same database:

```bash
docker compose exec addon node dist/scripts/discover.js
docker compose exec addon node dist/scripts/verify-streams.js --location IL
```

For HTTPS without opening ports, create a Cloudflare Tunnel that points at `http://addon:7000`, set `CLOUDFLARE_TUNNEL_TOKEN` and `BASE_URL`, then `docker compose --profile tunnel up -d`.

## Deploy to Cloudflare Workers

From GitHub: add the repository secrets `CLOUDFLARE_API_TOKEN` (a token with the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`, then run the `deploy-workers` workflow. It deploys `main` to `https://israeli-tv-addon.<your-subdomain>.workers.dev`.

From your computer:

```bash
npx wrangler login
npx wrangler d1 create israeli-tv-addon         # paste the id into wrangler.toml and uncomment [[d1_databases]]
npx wrangler secret put ADMIN_TOKEN
# put the provider settings under [vars] in wrangler.toml
npm run worker:deploy
```

The Worker runs health probes from Cloudflare's network every 30 minutes. It cannot run ffprobe, so playback verification runs elsewhere and is pushed in: `npm run verify -- --location IL --push https://israeli-tv-addon.<you>.workers.dev`.

Whether broadcasters accept requests from Cloudflare's network is not known yet. If the Israeli providers refuse it, use the Docker setup on a server in Israel.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/manifest.json` | Stremio manifest |
| `/catalog/tv/iltv-live[/genre=..&search=..&skip=..].json` | Live TV catalog |
| `/meta/tv/<id>.json`, `/stream/tv/<id>.json` | Channel details and fresh stream URLs |
| `/catalog/series/iltv-vod-<provider>[/genre=..&search=..&skip=..].json`, `/catalog/movie/iltv-movies.json` | VOD catalogs |
| `/meta/series/<id>.json`, `/stream/series/<episode id>.json`, `/meta/movie/<id>.json`, `/stream/movie/<id>.json` | Program with episodes, fresh episode streams |
| `/coverage` | Per provider: live channels discovered/verified/failing, VOD programs discovered, VOD episodes checked/verified, sample status |
| `/diagnostics` | Provider health, config issues, last checks per channel |
| `/health` | Liveness |
| `POST /admin/checks`, `POST /admin/probe` | Record checks / run probes now (Bearer `ADMIN_TOKEN`) |

Ids look like `iltv:live:<provider>:<channel>`, `iltv:vod:<provider>:<program>` and `iltv:vod:<provider>:<program>:<episode>`, and never change once released.

## Architecture

```
src/
  entry/node.ts, entry/worker.ts   runtime entry points (same app)
  bootstrap.ts, app.ts             wiring and Hono routes
  config.ts, logger.ts             Zod-validated env config, JSON-lines logs
  stremio/                         protocol schemas, ids, extra parsing
  services/addon.ts                catalog aggregation, caching, stream policy, health probes
  services/vod.ts                  VOD catalogs, series/movie meta, episode streams, sample verification
  services/health.ts               check results -> verified / reachable / failing / unverified
  providers/                       one adapter per broadcaster + registry (timeouts, isolation)
  media/                           HLS parsing, DRM detection, probing, manifest extraction
  verify/playback.ts               ffprobe decode check (Node only)
  storage/                         Store interface; memory, node:sqlite and D1 drivers
scripts/                           discover and verify CLIs
test/                              Vitest: unit, protocol and end-to-end with real HLS media
```

### Adding a broadcaster

Write a class that implements `ProviderAdapter` (`src/providers/types.ts`) with a `live` and/or `vod` capability, register it in `src/providers/index.ts`, and add its settings to `src/config.ts`. Return config problems from `issues()` instead of throwing. `resolveStreams` should fetch fresh URLs every time and set `expiresAt` for signed URLs, so caching stops before tokens expire. Mark `geo: "israel-only"` where the broadcaster restricts playback; skip DRM sources and log them.

## Tests

```bash
npm test          # needs ffmpeg/ffprobe for the end-to-end tests (skipped without them)
npm run typecheck
```

The end-to-end test generates a real HLS stream with ffmpeg, serves it locally and walks Stremio → Live TV → channel → stream → decoded video and audio. It also checks that a web page served as `.m3u8`, a stream without audio and a missing stream all fail.
