#!/usr/bin/env bash
# =============================================================================
#  One-shot EC2 bootstrap for CinemaSeat.
#
#  The lab (and its AWS account) is disposable and disappears after 12 hours,
#  so nothing may be configured by hand. Everything the instance needs is in
#  this file, in the repository.
#
#  On a fresh Ubuntu 22.04/24.04 instance:
#      curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/main/infra/ec2-setup.sh | bash -s -- <repo-url>
#  or, after cloning:
#      bash infra/ec2-setup.sh
#
#  Instance sizing: t3.small (2 GB) minimum. t2.micro has 1 GB and cannot hold
#  postgres + redis + api + worker + web + traefik + gateway.
#
#  Security group: 22 (your IP), 80 (0.0.0.0/0), 9000 (0.0.0.0/0, the gateway
#  is part of the specified interface and judges may hit it directly).
# =============================================================================
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="$HOME/apps/cinemaseat"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

step "System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl gnupg git python3 >/dev/null

step "Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
                              docker-buildx-plugin docker-compose-plugin >/dev/null
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker
docker --version
docker compose version

step "Swap"
# A t3.small has 2 GB and no swap by default. Docker builds are memory-hungry,
# and without swap the OOM killer picks a container mid-build.
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -h

step "Repository"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
elif [ -n "$REPO_URL" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "No repo at $APP_DIR and no repo URL given."
  echo "Usage: bash infra/ec2-setup.sh <repo-url>"
  exit 1
fi
cd "$APP_DIR"

step "Configuration"
# Nothing here is secret in the hackathon sense, but generating rather than
# committing keeps the habit honest and keeps .env out of git.
if [ ! -f .env ]; then
  cat > .env <<EOF
PROJECT_NAME=cinemaseat
HTTP_PORT=80
POSTGRES_USER=app
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=cinemaseat
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGINS=*
HOLD_TTL_SECONDS=120
PAYMENT_TIMEOUT_SECONDS=90
GATEWAY_MODE=live
DEBUG_FORCE_ENABLED=true
RATE_LIMIT_MAX=2000
EOF
  echo "  wrote .env (HTTP_PORT=80, generated DB password)"
else
  echo "  .env already present, leaving it alone"
fi

step "Deploy"
chmod +x deploy.sh
./deploy.sh

step "Done"
IP=$(curl -s --max-time 5 http://169.254.169.254/latest/meta-data/public-ipv4 || echo "<public-ip>")
echo "  App      : http://$IP"
echo "  Health   : http://$IP/health"
echo "  Gateway  : http://$IP:9000/health"
echo
echo "  For GitHub Actions CD, set these repository secrets:"
echo "    DEPLOY_HOST = $IP"
echo "    DEPLOY_USER = $USER"
echo "    DEPLOY_KEY  = the private half of the key you SSH in with"
echo
echo "  If docker was just installed, log out and back in before running"
echo "  docker without sudo."
