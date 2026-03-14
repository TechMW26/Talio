#!/usr/bin/env bash
# =============================================================================
# Talio HRMS — Production Deployment Script for Hostinger VPS (Ubuntu)
# =============================================================================
# Usage:
#   chmod +x deploy-production.sh
#   ./deploy-production.sh --fresh --ssl        # First-time full setup
#   ./deploy-production.sh                      # Redeploy / update (rebuild & restart)
#   ./deploy-production.sh --ssl                # Redeploy + renew/issue SSL
#
# Flags:
#   --fresh   Install all system dependencies (Docker, Docker Compose, etc.)
#   --ssl     Provision or renew SSL certificate via Let's Encrypt
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
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=true ;;
    --ssl)   SSL=true ;;
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

# ─── Load .env for DOMAIN and EMAIL ─────────────────────────────────────────
if [[ ! -f .env ]]; then
  err ".env file not found! Copy .env.example to .env and fill in your values."
  exit 1
fi

# Extract domain from NEXT_PUBLIC_APP_URL (strip protocol)
APP_URL=$(grep -E '^NEXT_PUBLIC_APP_URL=' .env | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
DOMAIN=$(echo "$APP_URL" | sed -E 's|https?://||' | sed 's|/.*||')

if [[ -z "$DOMAIN" ]]; then
  err "Could not determine domain. Set NEXT_PUBLIC_APP_URL in .env (e.g. https://app.talio.in)"
  exit 1
fi

# Email for Let's Encrypt (falls back to EMAIL_USER from .env)
SSL_EMAIL=$(grep -E '^SSL_EMAIL=' .env 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
if [[ -z "$SSL_EMAIL" ]]; then
  SSL_EMAIL=$(grep -E '^EMAIL_USER=' .env | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

log "Domain: $DOMAIN"
log "SSL Email: $SSL_EMAIL"

# =============================================================================
#  PHASE 1 — FRESH INSTALL (system dependencies)
# =============================================================================
if $FRESH; then
  header "Phase 1: Installing System Dependencies"

  # ── Update system ──
  info "Updating system packages..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get -y -o Dpkg::Options::="--force-confold" upgrade

  # ── Install essentials ──
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
#  PHASE 2 — PREPARE NGINX CONFIG (substitute domain)
# =============================================================================
header "Phase 2: Configuring Nginx"

NGINX_DIR="$SCRIPT_DIR/nginx/conf.d"

info "Setting domain ($DOMAIN) in nginx configs..."
# Replace placeholder _DOMAIN_ in all nginx config files
for conf_file in "$NGINX_DIR"/*.conf; do
  sed -i "s/_DOMAIN_/$DOMAIN/g" "$conf_file"
done
log "Nginx configs updated with domain: $DOMAIN"

# =============================================================================
#  PHASE 3 — BUILD & START CONTAINERS
# =============================================================================
header "Phase 3: Building & Starting Docker Containers"

# If SSL is requested and no cert exists yet, start with HTTP-only nginx
# so Certbot can complete the ACME challenge
if $SSL; then
  if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]] && \
     ! docker volume inspect talio_certbot_etc >/dev/null 2>&1; then
    SSL_FIRST_RUN=true
  else
    SSL_FIRST_RUN=false
  fi
else
  SSL_FIRST_RUN=false
fi

if $SSL_FIRST_RUN; then
  info "First-time SSL: starting with HTTP-only nginx for certificate provisioning..."
  # Swap in the HTTP-only config
  cp "$NGINX_DIR/default.conf" "$NGINX_DIR/default-ssl.conf.bak"
  cp "$NGINX_DIR/default-http-only.conf" "$NGINX_DIR/default.conf"
fi

info "Building Docker image (using cache for faster builds)..."
docker compose build talio-app

info "Starting containers..."
docker compose up -d

# Wait for app to be healthy
info "Waiting for application to become healthy..."
RETRIES=0
MAX_RETRIES=30
until docker compose exec -T talio-app wget --no-verbose --tries=1 --spider http://localhost:3000 2>/dev/null; do
  RETRIES=$((RETRIES + 1))
  if [[ $RETRIES -ge $MAX_RETRIES ]]; then
    warn "App did not become healthy after ${MAX_RETRIES} attempts. Check logs: docker compose logs talio-app"
    break
  fi
  sleep 5
done

if [[ $RETRIES -lt $MAX_RETRIES ]]; then
  log "Application is running and healthy!"
fi

# =============================================================================
#  PHASE 4 — SSL CERTIFICATE (Let's Encrypt via Certbot)
# =============================================================================
if $SSL; then
  header "Phase 4: SSL Certificate (Let's Encrypt)"

  if $SSL_FIRST_RUN; then
    info "Requesting SSL certificate for $DOMAIN..."

    # Give nginx a moment to be ready
    sleep 5

    # Run Certbot to obtain the certificate
    docker compose run --rm certbot certbot certonly \
      --webroot \
      -w /var/www/certbot \
      -d "$DOMAIN" \
      --email "$SSL_EMAIL" \
      --agree-tos \
      --no-eff-email \
      --non-interactive \
      --force-renewal

    if [[ $? -eq 0 ]]; then
      log "SSL certificate obtained successfully!"

      # Restore the full HTTPS nginx config
      info "Switching nginx to HTTPS configuration..."
      cp "$NGINX_DIR/default-ssl.conf.bak" "$NGINX_DIR/default.conf"
      rm -f "$NGINX_DIR/default-ssl.conf.bak"

      # Reload nginx to pick up SSL config
      docker compose restart nginx
      log "Nginx restarted with SSL enabled!"
    else
      err "Failed to obtain SSL certificate. Check DNS and ensure $DOMAIN points to this server."
      # Restore original config
      if [[ -f "$NGINX_DIR/default-ssl.conf.bak" ]]; then
        cp "$NGINX_DIR/default-ssl.conf.bak" "$NGINX_DIR/default.conf"
        rm -f "$NGINX_DIR/default-ssl.conf.bak"
      fi
      exit 1
    fi
  else
    info "Renewing SSL certificate..."
    docker compose run --rm certbot certbot renew --quiet
    docker compose exec -T nginx nginx -s reload 2>/dev/null || docker compose restart nginx
    log "SSL renewal complete!"
  fi
fi

# =============================================================================
#  PHASE 5 — SETUP CRON JOBS
# =============================================================================
header "Phase 5: Setting Up Cron Jobs"

# SSL auto-renewal cron (runs twice daily)
CRON_RENEW="0 3,15 * * * cd $SCRIPT_DIR && docker compose run --rm certbot certbot renew --quiet && docker compose exec -T nginx nginx -s reload 2>/dev/null"

# App cron jobs
CRON_SECRET=$(grep -E '^CRON_SECRET=' .env 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
NEXTAUTH_URL_VAL=$(grep -E '^NEXTAUTH_URL=' .env | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")

CRON_ABSENT="30 19 * * * curl -s -H 'x-cron-secret: ${CRON_SECRET}' '${NEXTAUTH_URL_VAL}/api/cron/mark-absent' >/dev/null 2>&1"
CRON_NOTIF="*/5 * * * * curl -s -H 'x-cron-secret: ${CRON_SECRET}' '${NEXTAUTH_URL_VAL}/api/cron/process-scheduled-notifications' >/dev/null 2>&1"
CRON_PROFILE="0 6 * * * curl -s -H 'x-cron-secret: ${CRON_SECRET}' '${NEXTAUTH_URL_VAL}/api/cron/check-profile-deadlines' >/dev/null 2>&1"
CRON_CLEANUP="0 2 * * 0 docker system prune -af --volumes --filter 'until=168h' >/dev/null 2>&1"

# Install cron jobs (idempotent — removes old talio entries first)
( crontab -l 2>/dev/null | grep -v '# talio-' || true
  echo "$CRON_RENEW   # talio-ssl-renew"
  echo "$CRON_ABSENT   # talio-mark-absent"
  echo "$CRON_NOTIF   # talio-notifications"
  echo "$CRON_PROFILE   # talio-profile-check"
  echo "$CRON_CLEANUP   # talio-docker-cleanup"
) | crontab -
log "Cron jobs installed"

# =============================================================================
#  PHASE 6 — HEALTH CHECK & SUMMARY
# =============================================================================
header "Phase 6: Deployment Summary"

echo ""
echo -e "${GREEN}┌─────────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│         🚀 Talio HRMS — Deployed!               │${NC}"
echo -e "${GREEN}├─────────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}│${NC}  Domain:    ${BOLD}$DOMAIN${NC}"
if $SSL; then
echo -e "${GREEN}│${NC}  URL:       ${BOLD}https://$DOMAIN${NC}"
echo -e "${GREEN}│${NC}  SSL:       ${GREEN}Active (auto-renew enabled)${NC}"
else
echo -e "${GREEN}│${NC}  URL:       ${BOLD}http://$DOMAIN${NC}"
echo -e "${GREEN}│${NC}  SSL:       ${YELLOW}Not configured${NC}"
fi
echo -e "${GREEN}│${NC}  App Port:  ${BOLD}3000 (internal)${NC}"
echo -e "${GREEN}│${NC}  Nginx:     ${BOLD}80/443 → 3000${NC}"
echo -e "${GREEN}├─────────────────────────────────────────────────┤${NC}"
echo -e "${GREEN}│${NC}  ${CYAN}Useful commands:${NC}"
echo -e "${GREEN}│${NC}    docker compose logs -f talio-app    ${CYAN}# app logs${NC}"
echo -e "${GREEN}│${NC}    docker compose logs -f nginx        ${CYAN}# nginx logs${NC}"
echo -e "${GREEN}│${NC}    docker compose restart talio-app    ${CYAN}# restart app${NC}"
echo -e "${GREEN}│${NC}    docker compose down                 ${CYAN}# stop all${NC}"
echo -e "${GREEN}│${NC}    docker compose up -d --build        ${CYAN}# rebuild & start${NC}"
echo -e "${GREEN}└─────────────────────────────────────────────────┘${NC}"
echo ""
