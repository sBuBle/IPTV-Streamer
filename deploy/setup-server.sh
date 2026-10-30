#!/usr/bin/env bash
# One-shot setup of the add-on on a fresh Ubuntu server (for example an Oracle Cloud free VM in Jerusalem).
# Installs Docker and Tailscale, starts the add-on, and publishes it over HTTPS with Tailscale Funnel,
# so no ports, domain or certificates are needed.
#
#   curl -fsSL https://raw.githubusercontent.com/sBuBle/IPTV-Streamer/main/deploy/setup-server.sh | bash
#
# Run it again to update to the newest code. The script asks you to open one Tailscale login link.
set -euo pipefail

REPO="${REPO:-https://github.com/sBuBle/IPTV-Streamer.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-$HOME/iptv-streamer}"
PORT=7000

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi
if ! command -v tailscale >/dev/null; then
  say "Installing Tailscale"
  curl -fsSL https://tailscale.com/install.sh | sudo sh
fi

say "Getting the add-on code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" reset --quiet --hard "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

if ! sudo tailscale status >/dev/null 2>&1; then
  say "Log in to Tailscale: open the link below in your browser (a free account is enough)"
  sudo tailscale up --hostname israeli-tv
fi
HOST="$(sudo tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
BASE_URL="https://$HOST"

COUNTRY="$(curl -fsS https://ipinfo.io/country 2>/dev/null || echo XX)"
if [ ! -f .env ]; then
  say "Writing .env"
  cp .env.example .env
  sed -i "s#^BASE_URL=.*#BASE_URL=$BASE_URL#" .env
  sed -i "s#^VERIFIER_LOCATION=.*#VERIFIER_LOCATION=$COUNTRY#" .env
  sed -i "s#^ADMIN_TOKEN=.*#ADMIN_TOKEN=$(openssl rand -hex 24)#" .env
fi

say "Building and starting the add-on"
sudo docker compose up -d --build addon
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 2; done
curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || { sudo docker compose logs --tail 50 addon; exit 1; }

say "Publishing over HTTPS with Tailscale Funnel"
# The first time, Tailscale may print a link to allow Funnel for your account; open it, then run this script again.
sudo tailscale funnel --bg "$PORT"

# Daily playback check from this server, so streams show "Playback verified" from this country.
CRON="17 4 * * * cd $DIR && sudo docker compose exec -T addon node dist/scripts/verify-streams.js --location $COUNTRY >> $DIR/verify.log 2>&1"
( crontab -l 2>/dev/null | grep -v verify-streams.js; echo "$CRON" ) | crontab -

say "Checking streams from here ($COUNTRY). This takes a few minutes."
sudo docker compose exec -T addon node dist/scripts/verify-streams.js --location "$COUNTRY" || true

cat <<EOF

Done. The add-on is running.

  Install page:   $BASE_URL/
  Manifest URL:   $BASE_URL/manifest.json   (paste into Stremio > Add-ons > search box)
  Coverage:       $BASE_URL/coverage

Send the manifest URL to Claude so it can test the add-on end to end.
EOF
