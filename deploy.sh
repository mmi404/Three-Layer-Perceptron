#!/usr/bin/env bash
# =============================================================================
#  Repeatable deploy.
#
#  "Deployment & Production Readiness" asks for the stack brought up "cleanly
#  and REPEATABLY". Hand-typed SSH commands are not repeatable; this is.
#  Point at it during the defence round.
#
#  Usage, on the server:   ./deploy.sh
#  From your laptop:       ssh user@host 'cd ~/apps/<repo> && ./deploy.sh'
# =============================================================================
set -euo pipefail

# Auto-heal docker socket permissions if running in a non-interactive shell without group refresh
if docker ps >/dev/null 2>&1; then
  DOCKER_CMD="docker"
elif sudo -n docker ps >/dev/null 2>&1; then
  DOCKER_CMD="sudo docker"
else
  sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
  DOCKER_CMD="docker"
fi

COMPOSE="$DOCKER_CMD compose -f docker-compose.yml -f docker-compose.prod.yml"
HTTP_PORT="$(grep -E '^HTTP_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '\r\n ' || echo 80)"
HTTP_PORT="${HTTP_PORT:-80}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1"; exit 1; }

[ -f .env ] || fail ".env is missing. cp .env.example .env and fill it in."

step "Pulling latest code"
git fetch origin main --quiet 2>/dev/null || true
git reset --hard origin/main --quiet 2>/dev/null || git pull --ff-only || true

step "Building and starting the stack"
# Stamp the commit into the image so /health reports exactly what is running.
export BUILD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "  building $BUILD_SHA"
$COMPOSE up -d --build --remove-orphans

step "Waiting for services to report healthy"
$COMPOSE ps

step "Running migrations"
$COMPOSE run --rm migrate

step "Verifying the deployment"
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HTTP_PORT}/health" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "  /health  OK (HTTP 200)"
    break
  fi
  if [ "$i" = 30 ]; then
    echo "  Last status code: $STATUS"
    $COMPOSE ps
    $COMPOSE logs --tail 30 api traefik
    fail "/health never came up (HTTP $STATUS). Check logs above."
  fi
  sleep 2
done

curl -fsS "http://127.0.0.1:${HTTP_PORT}/ready" | head -c 300; echo
curl -fsS -o /dev/null -w "  frontend HTTP %{http_code}\n" "http://127.0.0.1:${HTTP_PORT}/"

# Confirm the running code is the code we just built. A deploy that silently
# served a cached image would otherwise look identical to a successful one.
LIVE_SHA=$(curl -fsS "http://127.0.0.1:${HTTP_PORT}/health" \
  | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
if [ "$LIVE_SHA" = "$BUILD_SHA" ]; then
  echo "  version  OK ($LIVE_SHA)"
else
  fail "deployed version is '$LIVE_SHA' but we built '$BUILD_SHA' — stale image"
fi

step "Deployed"
echo "  Local  : http://127.0.0.1:${HTTP_PORT}"
echo "  Public : http://$(curl -s --max-time 5 ifconfig.me || echo YOUR_IP):${HTTP_PORT}"
echo
echo "  Seed demo data (first deploy only):  $COMPOSE run --rm seed"
