# ============================================
# Talio HRMS - Production Dockerfile (Optimized)
# Fast multi-stage build with minimal layers
# ============================================

# Use slim base for smaller image and faster pulls
FROM node:20-slim AS base

# Install runtime deps (libvips) in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    libvips-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Dependencies layer - cached unless package*.json changes
FROM base AS deps
WORKDIR /app

# Install build tools only for this stage (sharp fallback compile)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Copy only package files first (better cache)
COPY package.json package-lock.json* ./

# Install dependencies and sharp for linux-x64
ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_platform=linux \
    npm_config_arch=x64

RUN npm ci --legacy-peer-deps && \
    npm uninstall sharp && \
    npm install --os=linux --cpu=x64 sharp && \
    npm cache clean --force

# Source stage - preserve source files for runtime
FROM base AS source
WORKDIR /app
COPY . .

# Builder stage
FROM deps AS builder
WORKDIR /app

# Copy deps from previous stage (already have node_modules from deps stage)
COPY . .

# Build args for Next.js public envs
ARG NEXT_PUBLIC_APP_URL=https://app.talio.in
ARG NEXT_PUBLIC_APP_NAME=Talio
ARG NEXT_PUBLIC_GEMINI_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_ELEVENLABS_API_KEY
ARG NEXT_PUBLIC_ELEVENLABS_VOICE_ID
ARG NEXT_PUBLIC_ELEVENLABS_API_URL
# Firebase Web Push Notifications
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY

ENV NODE_ENV=production \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
    NEXT_PUBLIC_GEMINI_API_KEY=${NEXT_PUBLIC_GEMINI_API_KEY} \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID} \
    NEXT_PUBLIC_ELEVENLABS_API_KEY=${NEXT_PUBLIC_ELEVENLABS_API_KEY} \
    NEXT_PUBLIC_ELEVENLABS_VOICE_ID=${NEXT_PUBLIC_ELEVENLABS_VOICE_ID} \
    NEXT_PUBLIC_ELEVENLABS_API_URL=${NEXT_PUBLIC_ELEVENLABS_API_URL} \
    NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY} \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN} \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID} \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET} \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID} \
    NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID} \
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=${NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID} \
    NEXT_PUBLIC_FIREBASE_VAPID_KEY=${NEXT_PUBLIC_FIREBASE_VAPID_KEY} \
    SKIP_ENV_VALIDATION=true \
    NEXT_TELEMETRY_DISABLED=1

# Build Next.js
RUN npm run build && npm prune --production

# Production runner - minimal image
FROM node:20-slim AS runner
WORKDIR /app

# Install only runtime deps and dnsmasq for DNS caching
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    dnsutils \
    curl \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    # Node.js performance optimizations\
    UV_THREADPOOL_SIZE=16

# Copy only what's needed for production
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/server.js ./server.js
COPY --from=builder --chown=nextjs:nodejs /app/next.config.js ./next.config.js
# Copy source directories from source stage (preserved before build)
COPY --from=source --chown=nextjs:nodejs /app/lib ./lib
COPY --from=source --chown=nextjs:nodejs /app/models ./models

# Create uploads directory with all subdirectories
RUN mkdir -p /app/public/uploads/chat \
    /app/public/uploads/captures \
    /app/public/uploads/profile \
    /app/public/uploads/documents \
    /app/public/uploads/meetings \
    /app/public/uploads/temp \
    && chown -R nextjs:nodejs /app/public/uploads \
    && chmod -R 755 /app/public/uploads

USER nextjs
EXPOSE 3000

# Health check for Docker
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Run with optimized Node.js settings
CMD ["node", "--max-old-space-size=3072", "--max-http-header-size=32768", "server.js"]
