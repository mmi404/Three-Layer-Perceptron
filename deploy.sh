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

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
HTTP_PORT="$(grep -E '^HTTP_PORT=' .env | cut -d= -f2 || echo 8000)"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1"; exit 1; }

[ -f .env ] || fail ".env is missing. cp .env.example .env and fill it in."

step "Pulling latest code"
git pull --ff-only

step "Building and starting the stack"
$COMPOSE up -d --build --remove-orphans

step "Waiting for services to report healthy"
$COMPOSE ps

step "Running migrations"
$COMPOSE run --rm migrate

step "Verifying the deployment"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null 2>&1; then
    echo "  /health  OK"
    break
  fi
  [ "$i" = 20 ] && fail "/health never came up. Check: $COMPOSE logs --tail 100"
  sleep 3
done

curl -fsS "http://127.0.0.1:${HTTP_PORT}/ready" | head -c 300; echo
curl -fsS -o /dev/null -w "  frontend HTTP %{http_code}\n" "http://127.0.0.1:${HTTP_PORT}/"

step "Deployed"
echo "  Local  : http://127.0.0.1:${HTTP_PORT}"
echo "  Public : http://$(curl -s --max-time 5 ifconfig.me || echo YOUR_IP):${HTTP_PORT}"
echo
echo "  Seed demo data (first deploy only):  $COMPOSE run --rm seed"
