#!/bin/bash

# ============================================
# Talio - Production Deployment Script
# ============================================
# One-command deployment for Ubuntu/Debian servers
# Uses modern Docker commands (docker compose)
# Optimized for fast builds
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN="app.talio.in"
APP_DIR=$(pwd)

# Default options
FRESH_INSTALL=false
SETUP_SSL=false
SKIP_DEPS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --fresh)
            FRESH_INSTALL=true
            shift
            ;;
        --ssl)
            SETUP_SSL=true
            shift
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --help)
            echo "Talio - Production Deployment Script"
            echo ""
            echo "Usage: ./deploy-production.sh [options]"
            echo ""
            echo "Options:"
            echo "  --fresh       Fresh install (includes database seeding)"
            echo "  --ssl         Set up SSL with Certbot"
            echo "  --domain      Your domain name (default: app.talio.in)"
            echo "  --skip-deps   Skip dependency installation"
            echo "  --help        Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Docker compose command (modern syntax)
docker_compose() {
    docker compose "$@"
}

# Install system dependencies
install_dependencies() {
    log_info "Installing system dependencies..."
    
    apt-get update -qq
    apt-get install -y -qq \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        git \
        ufw \
        > /dev/null 2>&1
    
    log_success "System dependencies installed"
}

# Install Docker
install_docker() {
    if command -v docker &> /dev/null; then
        log_success "Docker is already installed"
        return
    fi
    
    log_info "Installing Docker..."
    
    # Use official install script (fastest method)
    curl -fsSL https://get.docker.com | sh
    
    # Start and enable Docker
    systemctl start docker
    systemctl enable docker
    
    log_success "Docker installed successfully"
}

# Install Nginx
install_nginx() {
    if command -v nginx &> /dev/null; then
        log_success "Nginx is already installed"
        return
    fi
    
    log_info "Installing Nginx..."
    apt-get install -y -qq nginx > /dev/null 2>&1
    systemctl start nginx
    systemctl enable nginx
    log_success "Nginx installed successfully"
}

# Install Certbot
install_certbot() {
    if command -v certbot &> /dev/null; then
        log_success "Certbot is already installed"
        return
    fi
    
    log_info "Installing Certbot..."
    apt-get install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1
    log_success "Certbot installed successfully"
}

# Configure firewall
configure_firewall() {
    log_info "Configuring firewall..."
    
    ufw --force reset > /dev/null 2>&1
    ufw default deny incoming > /dev/null 2>&1
    ufw default allow outgoing > /dev/null 2>&1
    ufw allow ssh > /dev/null 2>&1
    ufw allow 'Nginx Full' > /dev/null 2>&1
    ufw --force enable > /dev/null 2>&1
    
    log_success "Firewall configured"
}

# Check .env file
check_env_file() {
    log_info "Checking environment configuration..."
    
    if [ ! -f .env ]; then
        log_error ".env file not found!"
        log_info "Create .env file with: nano .env"
        exit 1
    fi
    
    # Use grep to extract values (handles special characters)
    MONGODB_URI=$(grep -E "^MONGODB_URI=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '\r')
    JWT_SECRET=$(grep -E "^JWT_SECRET=" .env 2>/dev/null | cut -d'=' -f2- | tr -d '\r')
    
    if [ -z "$MONGODB_URI" ]; then
        log_error "MONGODB_URI is not set in .env file"
        log_info "First 3 lines of .env:"
        head -3 .env
        exit 1
    fi
    
    if [ -z "$JWT_SECRET" ]; then
        log_error "JWT_SECRET is not set in .env file"
        exit 1
    fi
    
    log_success "Environment configuration validated"
}

# Configure Nginx HTTP
configure_nginx_http() {
    log_info "Configuring Nginx for ${DOMAIN}..."
    
    mkdir -p /var/www/certbot
    
    cat > /etc/nginx/sites-available/talio <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    location /api/socketio {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}
EOF

    rm -f /etc/nginx/sites-enabled/default
    ln -sf /etc/nginx/sites-available/talio /etc/nginx/sites-enabled/talio
    nginx -t && systemctl reload nginx
    
    log_success "Nginx configured"
}

# Configure Nginx with SSL
configure_nginx_ssl() {
    log_info "Configuring Nginx with SSL..."
    
    cat > /etc/nginx/sites-available/talio <<EOF
upstream talio_app {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=63072000" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml;

    location / {
        proxy_pass http://talio_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    location /api/socketio {
        proxy_pass http://talio_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location /_next/static {
        proxy_pass http://talio_app;
        proxy_cache_valid 60m;
        add_header Cache-Control "public, immutable";
    }
}
EOF

    nginx -t && systemctl reload nginx
    log_success "Nginx SSL configured"
}

# Obtain SSL certificate
obtain_ssl_certificate() {
    log_info "Obtaining SSL certificate for ${DOMAIN}..."
    
    mkdir -p /var/www/certbot
    
    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        log_success "SSL certificate already exists"
        configure_nginx_ssl
        return
    fi
    
    certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email admin@${DOMAIN} \
        --agree-tos \
        --no-eff-email \
        -d ${DOMAIN}
    
    if [ $? -eq 0 ]; then
        log_success "SSL certificate obtained"
        configure_nginx_ssl
        
        # Setup auto-renewal
        mkdir -p /etc/letsencrypt/renewal-hooks/deploy
        cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<EOF
#!/bin/bash
systemctl reload nginx
EOF
        chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
        
        echo "0 0,12 * * * root certbot renew --quiet" > /etc/cron.d/certbot-renew
        log_success "SSL auto-renewal configured"
    else
        log_warning "Failed to obtain SSL - continuing with HTTP"
    fi
}

# Pull latest code
pull_latest_code() {
    log_info "Pulling latest code..."
    
    if [ -d .git ]; then
        git fetch origin
        git pull origin main
        log_success "Code updated"
    fi
}

# Deploy with Docker
deploy_docker() {
    log_info "Deploying with Docker..."
    
    # Enable BuildKit for faster builds
    export DOCKER_BUILDKIT=1
    export COMPOSE_DOCKER_CLI_BUILD=1
    
    # Check if we can do zero-downtime deployment
    RUNNING_CONTAINER=$(docker_compose ps -q app 2>/dev/null || true)
    
    if [ -n "$RUNNING_CONTAINER" ]; then
        log_info "Performing zero-downtime deployment..."
        
        # Build new image while old container is still running
        log_info "Building new Docker image (old container still serving traffic)..."
        docker_compose build --build-arg BUILDKIT_INLINE_CACHE=1
        
        # Quick container swap
        log_info "Swapping to new container..."
        docker_compose up -d --force-recreate --no-deps app
    else
        log_info "No existing container, doing fresh deployment..."
        
        # Clean up old images to save space
        log_info "Cleaning up old images..."
        docker image prune -f > /dev/null 2>&1 || true
        
        # Build with cache for faster builds
        log_info "Building Docker image..."
        docker_compose build --build-arg BUILDKIT_INLINE_CACHE=1
        
        # Start containers
        log_info "Starting containers..."
        docker_compose up -d
    fi
    
    # Wait and check
    log_info "Waiting for application to start (health check)..."
    
    # Health check loop
    for i in {1..30}; do
        if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
            log_success "Application is healthy and responding!"
            break
        fi
        if [ $i -eq 30 ]; then
            log_error "Health check failed after 30 seconds"
            docker_compose logs --tail=50
            exit 1
        fi
        sleep 1
    done
    
    if docker_compose ps | grep -q "Up\|running"; then
        log_success "Docker containers are running"
    else
        log_error "Containers failed to start"
        docker_compose logs --tail=50
        exit 1
    fi
    
    # Clean up old images after successful deployment
    log_info "Cleaning up dangling images..."
    docker image prune -f > /dev/null 2>&1 || true
}

# Seed database
seed_database() {
    log_info "Seeding database..."
    sleep 5
    docker_compose exec -T app npm run seed || log_warning "Seeding had issues"
    log_success "Database seeding complete"
}

# Setup vector search
setup_vector_search() {
    log_info "Setting up vector search..."
    docker_compose exec -T app node scripts/setup-vector-db.js 2>/dev/null || true
    docker_compose exec -T app node scripts/generate-embeddings-free.js 2>/dev/null || true
    log_success "Vector search setup complete"
}

# Health check
health_check() {
    log_info "Performing health check..."
    
    for i in 1 2 3 4 5; do
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
        
        if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "302" ]; then
            log_success "Application is running (HTTP $HTTP_STATUS)"
            return
        fi
        
        log_info "Waiting... (attempt $i/5)"
        sleep 5
    done
    
    log_warning "App may still be starting - check: docker compose logs -f"
}

# Show status
show_status() {
    echo ""
    echo "============================================"
    echo -e "${GREEN}  Deployment Complete!${NC}"
    echo "============================================"
    echo ""
    docker_compose ps
    echo ""
    echo "Commands:"
    echo "  Logs:    docker compose logs -f"
    echo "  Restart: docker compose restart"
    echo "  Stop:    docker compose down"
    echo "  Rebuild: docker compose up -d --build"
    echo ""
    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        echo -e "URL: ${GREEN}https://${DOMAIN}${NC}"
    else
        echo "URL: http://${DOMAIN}"
    fi
    echo ""
    echo "Note: Old service workers will be automatically"
    echo "      unregistered on user's next visit."
    echo "============================================"
}

# Main
main() {
    echo ""
    echo "============================================"
    echo "  Talio - Production Deployment"
    echo "============================================"
    echo "  Domain: ${DOMAIN}"
    echo "============================================"
    echo ""
    
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run as root: sudo ./deploy-production.sh"
        exit 1
    fi
    
    if ! $SKIP_DEPS; then
        install_dependencies
        install_docker
        install_nginx
        if $SETUP_SSL; then
            install_certbot
        fi
        configure_firewall
    fi
    
    check_env_file
    pull_latest_code
    configure_nginx_http
    deploy_docker
    
    if $SETUP_SSL; then
        obtain_ssl_certificate
    fi
    
    if $FRESH_INSTALL; then
        seed_database
        setup_vector_search
    fi
    
    health_check
    show_status
}

main
