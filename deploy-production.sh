#!/usr/bin/env bash
# =============================================================================
# Talio HRMS - Production Deployment Script for Hostinger VPS (Ubuntu)
# =============================================================================
# Usage:
#   chmod +x deploy-production.sh
#   ./deploy-production.sh --fresh --ssl        # First-time full setup
#   ./deploy-production.sh                      # Redeploy / update (fast cached rebuild)
#   ./deploy-production.sh --ssl                # Redeploy + renew/issue SSL
#   ./deploy-production.sh --clean               # Full rebuild from scratch (no Docker cache)
#
# Flags:
#   --fresh   Install all system dependencies (Docker, Docker Compose, etc.)
#   --ssl     Provision or renew SSL certificate via Let's Encrypt
#   --clean   Force a full Docker rebuild with no layer cache
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✔]${NC} $*"; }
warn()  { echo -e "${YELLOW}[⚠]${NC} $*"; }
err()   { echo -e "${RED}[✖]${NC} $*" >&2; }
info()  { echo -e "${CYAN}[→]${NC} $*"; }
header(){ echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${BOLD}  $*${NC}"; echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }

# ─── Parse flags ─────────────────────────────────────────────────────────────
FRESH=false
SSL=false
CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=true ;;
    --ssl)   SSL=true ;;
    --clean) CLEAN=true ;;
    *) err "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ─── Must run as root (or sudo) ─────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root.  Use:  sudo ./deploy-production.sh [flags]"
  exit 1
fi

# ─── Resolve project directory (where this script lives) ────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
log "Working directory: $SCRIPT_DIR"

# ─── Load .env ──────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  err ".env file not found! Copy .env.example to .env and fill in your values."
  exit 1
fi

# Extract domain from NEXT_PUBLIC_APP_URL (strip protocol and trailing path)
APP_URL=$(grep -E '^NEXT_PUBLIC_APP_URL=' .env | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
DOMAIN=$(echo "$APP_URL" | sed -E 's|https?://||' | sed 's|/.*||')

if [[ -z "$DOMAIN" ]]; then
  err "Could not determine domain. Set NEXT_PUBLIC_APP_URL in .env (e.g. https://app.talio.in)"
  exit 1
fi

# Email for Let's Encrypt - reads EMAIL_USER from .env
SSL_EMAIL=$(grep -E '^EMAIL_USER=' .env | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [[ -z "$SSL_EMAIL" ]]; then
  err "EMAIL_USER not found in .env. Certbot needs an email for certificate notifications."
  exit 1
fi

log "Domain: $DOMAIN"
log "SSL Email: $SSL_EMAIL"

NGINX_DIR="$SCRIPT_DIR/nginx/conf.d"

# ─── Helper: check if SSL certs already exist (inside the Docker volume) ────
ssl_certs_exist() {
  docker compose run --rm --entrypoint "" certbot \
    test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" 2>/dev/null
}

# =============================================================================
#  PHASE 1 - FRESH INSTALL (system dependencies)
# =============================================================================
if $FRESH; then
  header "Phase 1: Installing System Dependencies"

  export DEBIAN_FRONTEND=noninteractive
  info "Updating system packages..."
  apt-get update -y
  apt-get -y -o Dpkg::Options::="--force-confold" upgrade

  info "Installing essential packages..."
  apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common \
    ufw \
    fail2ban \
    git \
    wget \
    unzip \
    htop

  # ── Install Docker ──
  if ! command -v docker &>/dev/null; then
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log "Docker installed: $(docker --version)"
  else
    log "Docker already installed: $(docker --version)"
  fi

  # ── Install Docker Compose (plugin) ──
  if ! docker compose version &>/dev/null; then
    info "Installing Docker Compose plugin..."
    apt-get install -y docker-compose-plugin
    log "Docker Compose installed: $(docker compose version)"
  else
    log "Docker Compose already installed: $(docker compose version)"
  fi

  # ── Configure firewall ──
  info "Configuring firewall (UFW)..."
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp    # SSH
  ufw allow 80/tcp    # HTTP
  ufw allow 443/tcp   # HTTPS
  ufw --force enable
  log "Firewall configured (SSH, HTTP, HTTPS allowed)"

  # ── Enable fail2ban ──
  systemctl enable fail2ban
  systemctl start fail2ban
  log "fail2ban enabled"

  # ── Set swapfile (2GB) for low-memory VPS ──
  if [[ ! -f /swapfile ]]; then
    info "Creating 2GB swap file..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap file created and enabled"
  else
    log "Swap file already exists"
  fi

  # ── Kernel tuning ──
  info "Applying kernel performance tweaks..."
  cat > /etc/sysctl.d/99-talio.conf <<'SYSCTL'
# Network performance
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
# File descriptors
fs.file-max = 2097152
# VM
vm.swappiness = 10
vm.overcommit_memory = 1
SYSCTL
  sysctl -p /etc/sysctl.d/99-talio.conf >/dev/null 2>&1 || true
  log "Kernel tweaks applied"

  log "System dependency installation complete!"
fi

# =============================================================================
#  PHASE 2 - PREPARE NGINX CONFIG
# =============================================================================
header "Phase 2: Configuring Nginx"

# Determine if we need SSL provisioning (first-time) or already have certs
NEED_SSL_PROVISION=false

if $SSL; then
  docker compose pull certbot 2>/dev/null || true
  if ssl_certs_exist; then
    info "SSL certificates already exist for $DOMAIN - will renew if needed."
  else
    NEED_SSL_PROVISION=true
    info "No SSL certificates found - will provision new ones."
  fi
fi

# Write the correct nginx config BEFORE starting containers.
# Only ONE file should ever exist as *.conf - templates are *.conf.template
# and are ignored by nginx's `include *.conf` directive.
write_http_only_config() {
  # Inline the HTTP-only config directly (no separate file needed)
  cat > "$NGINX_DIR/default.conf" <<NGINXCONF
upstream talio_backend {
    server talio-app:3000;
    keepalive 64;
}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Maintenance page for upstream failures
    error_page 502 503 504 /maintenance.html;
    location = /maintenance.html {
        root /usr/share/nginx/html;
        internal;
    }

    location /api/socketio {
        proxy_pass http://talio_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location /api/ {
        proxy_pass http://talio_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    location /_next/static/ {
        proxy_pass http://talio_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        expires 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    location / {
        proxy_pass http://talio_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
    }
}
NGINXCONF
  log "HTTP-only nginx config written"
}

write_https_config() {
  cp "$NGINX_DIR/default.conf.template" "$NGINX_DIR/default.conf"
  sed -i "s/_DOMAIN_/$DOMAIN/g" "$NGINX_DIR/default.conf"
  log "HTTPS nginx config written"
}

if $NEED_SSL_PROVISION; then
  # First-time SSL: start with HTTP-only so nginx can boot without certs
  info "Using HTTP-only nginx config for initial SSL provisioning..."
  write_http_only_config
elif $SSL; then
  # Certs exist: use full HTTPS config
  info "Using HTTPS nginx config (certs exist)..."
  write_https_config
else
  # No SSL requested: ensure domain is substituted in existing config
  sed -i "s/_DOMAIN_/$DOMAIN/g" "$NGINX_DIR/default.conf" 2>/dev/null || true
fi

log "Nginx config ready for $DOMAIN"

# =============================================================================
#  PHASE 3 - BUILD & START CONTAINERS
# =============================================================================
header "Phase 3: Building & Starting Docker Containers"

# ── Full stack teardown before rebuild ───────────────────────────────────────
# Always stop nginx and the app together before rebuilding so nginx cannot keep
# a stale upstream container IP from a previous deployment.
info "Bringing down existing stack to prevent stale nginx upstream state..."
docker compose down --remove-orphans

if $CLEAN || $FRESH; then
  info "Pruning BuildKit cache to remove stale npm/sharp artifacts..."
  docker builder prune -af >/dev/null 2>&1 || true
  info "Building Docker image (full rebuild, no cache)..."
  DOCKER_BUILDKIT=1 docker compose build --no-cache talio-app
else
  info "Building Docker image (cached - use --clean for full rebuild)..."
  DOCKER_BUILDKIT=1 docker compose build talio-app
fi

info "Starting containers..."
docker compose up -d

# Clean up old Docker images/layers to prevent storage bloat
info "Pruning old Docker images..."
docker image prune -f --filter "until=1h" 2>/dev/null || true

# ── Wait for health check ────────────────────────────────────────────────────
# Polls `docker inspect` for the container health status every 5 seconds,
# up to 120 seconds. Only declares success after confirmed healthy.
info "Waiting for talio-app to become healthy (timeout: 120s)..."
HEALTH_TIMEOUT=120
HEALTH_INTERVAL=5
ELAPSED=0

while [[ $ELAPSED -lt $HEALTH_TIMEOUT ]]; do
  HEALTH=$(docker inspect talio-app --format='{{.State.Health.Status}}' 2>/dev/null || echo "missing")

  if [[ "$HEALTH" == "healthy" ]]; then
    log "Deployment successful - app is healthy after ${ELAPSED}s!"
    break
  fi

  # ── Restart loop detection ─────────────────────────────────────────────
  # If the container has restarted more than 2 times, it's crash-looping.
  RESTART_COUNT=$(docker inspect talio-app --format='{{.RestartCount}}' 2>/dev/null || echo "0")
  if [[ "$RESTART_COUNT" -gt 2 ]]; then
    err "Container is crash-looping (RestartCount: $RESTART_COUNT)."
    err "Stopping container to prevent infinite restart loop..."
    docker compose stop talio-app
    err "Last 50 lines of talio-app logs:"
    docker logs talio-app --tail 50
    err "Fix the issue above, then re-run the deploy script."
    exit 1
  fi

  if [[ "$HEALTH" == "unhealthy" ]]; then
    warn "Health check reports unhealthy at ${ELAPSED}s - checking logs..."
    docker logs talio-app --tail 20
    # Don't exit yet - the app may just be slow to start
  fi

  sleep $HEALTH_INTERVAL
  ELAPSED=$((ELAPSED + HEALTH_INTERVAL))
done

# ── Final health verdict ─────────────────────────────────────────────────────
if [[ "$HEALTH" != "healthy" ]]; then
  err "Application did NOT become healthy within ${HEALTH_TIMEOUT}s."
  err "Current health status: $HEALTH"
  err "Last 50 lines of talio-app logs:"
  docker logs talio-app --tail 50
  err "Deployment FAILED. Fix the issue above and re-deploy."
  exit 1
fi

# Also verify nginx is running (not crash-looping)
if ! docker compose exec -T nginx nginx -t 2>/dev/null; then
  warn "Nginx config test failed - checking logs..."
  docker compose logs nginx --tail 20
fi

# =============================================================================
#  PHASE 4 - SSL CERTIFICATE (Let's Encrypt via Certbot)
# =============================================================================
if $SSL; then
  header "Phase 4: SSL Certificate (Let's Encrypt)"

  if $NEED_SSL_PROVISION; then
    # ── First-time: obtain certificate ───────────────────────────────────────
    info "Requesting SSL certificate for $DOMAIN..."

    # Wait for nginx to be fully up and serving port 80
    info "Waiting for nginx to be ready on port 80..."
    NGINX_RETRIES=0
    until curl -s -o /dev/null -w '%{http_code}' http://localhost | grep -qE '(200|301|302|404)'; do
      NGINX_RETRIES=$((NGINX_RETRIES + 1))
      if [[ $NGINX_RETRIES -ge 12 ]]; then
        err "Nginx is not responding on port 80 after 60 seconds."
        err "Check: docker compose logs nginx --tail 30"
        exit 1
      fi
      sleep 5
    done
    log "Nginx is serving HTTP on port 80"

    docker compose run --rm certbot certonly \
      --webroot \
      -w /var/www/certbot \
      -d "$DOMAIN" \
      --email "$SSL_EMAIL" \
      --agree-tos \
      --no-eff-email \
      --non-interactive

    log "SSL certificate obtained successfully!"

    # ── Switch to full HTTPS config now that certs exist ─────────────────────
    info "Switching nginx to HTTPS configuration..."
    write_https_config

    # Restart nginx so it picks up the HTTPS config + certs
    docker compose restart nginx
    sleep 3

    # Verify HTTPS nginx is running
    if docker compose exec -T nginx nginx -t 2>/dev/null; then
      log "Nginx restarted with SSL enabled!"
    else
      err "Nginx failed to start with HTTPS config. Check: docker compose logs nginx"
    fi

  else
    # ── Renewal: certs already exist ─────────────────────────────────────────
    info "Renewing SSL certificate..."
    docker compose run --rm certbot renew --quiet
    docker compose exec -T nginx nginx -s reload 2>/dev/null || docker compose restart nginx
    log "SSL renewal complete!"
  fi
fi

# =============================================================================
#  PHASE 5 - SETUP CRON JOBS
# =============================================================================
header "Phase 5: Setting Up Cron Jobs"

# Read cron-related env values
CRON_SECRET=$(grep -E '^CRON_SECRET=' .env 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
NEXTAUTH_URL_VAL=$(grep -E '^NEXTAUTH_URL=' .env | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")

# SSL auto-renewal (twice daily)
CRON_RENEW="0 3,15 * * * cd $SCRIPT_DIR && docker compose run --rm certbot renew --quiet && docker compose exec -T nginx nginx -s reload 2>/dev/null"

# Application cron jobs
CRON_ABSENT="30 19 * * * curl -s -H 'x-cron-secret: ${CRON_SECRET}' '${NEXTAUTH_URL_VAL}/api/cron/mark-absent' >/dev/null 2>&1"
CRON_NOTIF="*/5 * * * * curl -s -H 'x-cron-secret: ${CRON_SECRET}' '${NEXTAUTH_URL_VAL}/api/cron/process-scheduled-notifications' >/dev/null 2>&1"
CRON_PROFILE="0 6 * * * curl -s -H 'x-cron-secret: ${CRON_SECRET}' '${NEXTAUTH_URL_VAL}/api/cron/check-profile-deadlines' >/dev/null 2>&1"
CRON_CLEANUP="0 2 * * 0 docker image prune -af --filter 'until=168h' && docker builder prune -af --keep-storage=2GB 2>/dev/null >/dev/null 2>&1"

# Install cron jobs (idempotent - removes old talio entries first)
( crontab -l 2>/dev/null | grep -v '# talio-' || true
  echo "$CRON_RENEW   # talio-ssl-renew"
  echo "$CRON_ABSENT   # talio-mark-absent"
  echo "$CRON_NOTIF   # talio-notifications"
  echo "$CRON_PROFILE   # talio-profile-check"
  echo "$CRON_CLEANUP   # talio-docker-cleanup"
) | crontab -
log "Cron jobs installed"

# =============================================================================
#  PHASE 6 - HEALTH CHECK & SUMMARY
# =============================================================================
header "Phase 6: Deployment Summary"

echo ""
echo -e "${GREEN}┌─────────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│         Talio HRMS - Deployed!                  │${NC}"
echo -e "${GREEN}├─────────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}│${NC}  Domain:    ${BOLD}$DOMAIN${NC}"
if $SSL; then
echo -e "${GREEN}│${NC}  URL:       ${BOLD}https://$DOMAIN${NC}"
echo -e "${GREEN}│${NC}  SSL:       ${GREEN}Active (auto-renew enabled)${NC}"
else
echo -e "${GREEN}│${NC}  URL:       ${BOLD}http://$DOMAIN${NC}"
echo -e "${GREEN}│${NC}  SSL:       ${YELLOW}Not configured (run with --ssl)${NC}"
fi
echo -e "${GREEN}│${NC}  App Port:  ${BOLD}3000 (internal)${NC}"
echo -e "${GREEN}│${NC}  Nginx:     ${BOLD}80/443 → 3000${NC}"
echo -e "${GREEN}├─────────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}│${NC}  ${YELLOW}Avoid restarting only talio-app in production.${NC}"
echo -e "${GREEN}│${NC}  ${YELLOW}Use a full stack redeploy so nginx refreshes its upstream.${NC}"
echo -e "${GREEN}├─────────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}│${NC}  ${CYAN}Useful commands:${NC}"
echo -e "${GREEN}│${NC}    docker compose logs -f talio-app    ${CYAN}# app logs${NC}"
echo -e "${GREEN}│${NC}    docker compose logs -f nginx        ${CYAN}# nginx logs${NC}"
echo -e "${GREEN}│${NC}    ./deploy-production.sh              ${CYAN}# safe redeploy${NC}"
echo -e "${GREEN}│${NC}    docker compose down                 ${CYAN}# stop all${NC}"
echo -e "${GREEN}│${NC}    docker compose down --remove-orphans && DOCKER_BUILDKIT=1 docker compose build talio-app && docker compose up -d${CYAN} # manual full redeploy${NC}"
echo -e "${GREEN}└─────────────────────────────────────────────────┘${NC}"
echo ""
