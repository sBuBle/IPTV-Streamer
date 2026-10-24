# Israeli TV for Stremio

A Stremio add-on for Israeli live TV, with VOD to follow. It runs on Cloudflare Workers (free plan) or on any server with Node 22 or Docker.

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
| Kan, Reshet 13, Keshet 12, Channel 14, VOD | Not started (roadmap phases 3 to 5) |

"Verified" means a real decode of video and audio, run by the `verify-streams` GitHub workflow from GitHub's US network. Both providers work with no setup. The other Israeli broadcasters block viewers outside Israel, so they will need a host in Israel.

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
| `/coverage` | Per provider: discovered, verified, reachable, failing, unchecked, verified coverage % |
| `/diagnostics` | Provider health, config issues, last checks per channel |
| `/health` | Liveness |
| `POST /admin/checks`, `POST /admin/probe` | Record checks / run probes now (Bearer `ADMIN_TOKEN`) |

Ids look like `iltv:live:<provider>:<channel>` and never change once released.

## Architecture

```
src/
  entry/node.ts, entry/worker.ts   runtime entry points (same app)
  bootstrap.ts, app.ts             wiring and Hono routes
  config.ts, logger.ts             Zod-validated env config, JSON-lines logs
  stremio/                         protocol schemas, ids, extra parsing
  services/addon.ts                catalog aggregation, caching, stream policy, health probes
  services/health.ts               check results -> verified / reachable / failing / unverified
  providers/                       one adapter per broadcaster + registry (timeouts, isolation)
  media/                           HLS parsing, DRM detection, probing, manifest extraction
  verify/playback.ts               ffprobe decode check (Node only)
  storage/                         Store interface; memory, node:sqlite and D1 drivers
scripts/                           discover and verify CLIs
test/                              Vitest: unit, protocol and end-to-end with real HLS media
```

### Adding a broadcaster

Write a class that implements `ProviderAdapter` (`src/providers/types.ts`), register it in `src/providers/index.ts`, and add its settings to `src/config.ts`. Return config problems from `issues()` instead of throwing. `resolveStreams` should fetch fresh URLs every time and set `expiresAt` for signed URLs, so caching stops before tokens expire. Mark `geo: "israel-only"` where the broadcaster restricts playback; skip DRM sources and log them.

## Tests

```bash
npm test          # needs ffmpeg/ffprobe for the end-to-end tests (skipped without them)
npm run typecheck
```

The end-to-end test generates a real HLS stream with ffmpeg, serves it locally and walks Stremio → Live TV → channel → stream → decoded video and audio. It also checks that a web page served as `.m3u8`, a stream without audio and a missing stream all fail.
