#!/bin/bash

# Talio Deployment Script for Digital Ocean Ubuntu Server
# Usage: ./deploy.sh

set -e

echo "🚀 Starting Talio Deployment to Digital Ocean..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_error "Please don't run this script as root"
    exit 1
fi

# Update system packages
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
    print_status "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    print_success "Docker installed successfully"
else
    print_success "Docker is already installed"
fi

# Install Docker Compose if not installed
if ! command -v docker-compose &> /dev/null; then
    print_status "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    print_success "Docker Compose installed successfully"
else
    print_success "Docker Compose is already installed"
fi

# Install Git if not installed
if ! command -v git &> /dev/null; then
    print_status "Installing Git..."
    sudo apt install git -y
    print_success "Git installed successfully"
else
    print_success "Git is already installed"
fi

# Create application directory
APP_DIR="/home/$USER/hrms-app"
print_status "Creating application directory at $APP_DIR..."
mkdir -p $APP_DIR
cd $APP_DIR

# Clone or update repository
if [ -d ".git" ]; then
    print_status "Updating existing repository..."
    git pull origin main
else
    print_status "Cloning repository..."
    print_warning "Please enter your GitHub repository URL:"
    read -p "Repository URL: " REPO_URL
    git clone $REPO_URL .
fi

# Create environment file
print_status "Setting up environment variables..."
if [ ! -f ".env" ]; then
    cat > .env << EOF
# MongoDB Configuration
MONGODB_URI=mongodb+srv://your-username:your-password@your-cluster.mongodb.net/hrms?

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-make-it-long-and-random

# NextAuth Configuration
NEXTAUTH_SECRET=your-nextauth-secret-key-here-also-make-it-random
NEXTAUTH_URL=http://your-domain.com

# Node Environment
NODE_ENV=production
EOF
    print_warning "Please edit .env file with your actual configuration:"
    print_warning "nano .env"
    print_warning "Press any key to continue after editing..."
    read -n 1 -s
else
    print_success "Environment file already exists"
fi

# Create SSL directory (for future SSL certificates)
mkdir -p ssl

# Set proper permissions
print_status "Setting proper permissions..."
sudo chown -R $USER:$USER $APP_DIR
chmod +x deploy.sh

# Build and start the application
print_status "Building and starting the application..."
docker-compose down --remove-orphans
docker-compose build --no-cache
docker-compose up -d

# Wait for services to start
print_status "Waiting for services to start..."
sleep 30

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    print_success "Talio is now running!"
    print_success "Access your application at: http://$(curl -s ifconfig.me)"
    print_success "Local access: http://localhost"
else
    print_error "Failed to start services. Check logs with: docker-compose logs"
    exit 1
fi

# Display useful commands
echo ""
print_status "Useful commands:"
echo "  View logs: docker-compose logs -f"
echo "  Stop app: docker-compose down"
echo "  Restart: docker-compose restart"
echo "  Update: git pull && docker-compose up -d --build"
echo ""

# Setup firewall
print_status "Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

print_success "🎉 Talio deployment completed successfully!"
print_status "Your application is now accessible!"

# Display final information
echo ""
echo "================================================="
echo "🎊 DEPLOYMENT SUMMARY"
echo "================================================="
echo "✅ Docker and Docker Compose installed"
echo "✅ Talio application deployed"
echo "✅ Nginx reverse proxy configured"
echo "✅ Firewall configured"
echo ""
echo "🌐 Access URL: http://$(curl -s ifconfig.me)"
echo "📱 Native apps available for download from the app"
echo "🔄 Application runs with offline detection"
echo ""
echo "📝 Next steps:"
echo "1. Configure your domain name"
echo "2. Set up SSL certificates for HTTPS"
echo "3. Update NEXTAUTH_URL in .env file"
echo "4. Download native apps from /download page"
echo "=================================================="
