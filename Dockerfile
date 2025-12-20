# ============================================
# Talio HRMS - Production Dockerfile (Optimized)
# Fast multi-stage build with minimal layers
# ============================================

# Use slim base for smaller image and faster pulls
FROM node:20-slim AS base

# Install only essential OS deps in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# Dependencies layer - cached unless package*.json changes
FROM base AS deps
WORKDIR /app

# Copy only package files first (better cache)
COPY package.json package-lock.json* ./

# Install with optimized settings
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=0 \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

RUN npm ci --legacy-peer-deps --omit=dev --ignore-scripts && \
    npm cache clean --force

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build args for Next.js public envs
ARG NEXT_PUBLIC_APP_URL=https://app.talio.in
ARG NEXT_PUBLIC_APP_NAME=Talio
ARG NEXT_PUBLIC_GEMINI_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_ELEVENLABS_API_KEY
ARG NEXT_PUBLIC_ELEVENLABS_VOICE_ID
ARG NEXT_PUBLIC_ELEVENLABS_API_URL

ENV NODE_ENV=production \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
    NEXT_PUBLIC_GEMINI_API_KEY=${NEXT_PUBLIC_GEMINI_API_KEY} \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID} \
    NEXT_PUBLIC_ELEVENLABS_API_KEY=${NEXT_PUBLIC_ELEVENLABS_API_KEY} \
    NEXT_PUBLIC_ELEVENLABS_VOICE_ID=${NEXT_PUBLIC_ELEVENLABS_VOICE_ID} \
    NEXT_PUBLIC_ELEVENLABS_API_URL=${NEXT_PUBLIC_ELEVENLABS_API_URL} \
    SKIP_ENV_VALIDATION=true \
    NEXT_TELEMETRY_DISABLED=1

# Build Next.js
RUN npm run build

# Production runner - minimal image
FROM node:20-slim AS runner
WORKDIR /app

# Install only runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Copy only what's needed for production
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/server.js ./server.js
COPY --from=builder --chown=nextjs:nodejs /app/next.config.js ./next.config.js
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/models ./models

# Create uploads directory
RUN mkdir -p /app/public/uploads && chown -R nextjs:nodejs /app/public/uploads

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
