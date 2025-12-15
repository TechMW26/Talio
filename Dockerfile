# ============================================
# Talio HRMS - Production Dockerfile
# ============================================

FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache \
    libc6-compat \
    python3 \
    make \
    g++ \
    vips-dev \
    fftw-dev \
    build-base

# Copy package files
COPY package*.json ./

# Install dependencies
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
RUN npm ci --legacy-peer-deps

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Copy env file if exists (using shell workaround for Alpine)
COPY .env* ./

# Build arguments
ARG NEXT_PUBLIC_APP_URL=https://app.talio.in
ARG NEXT_PUBLIC_APP_NAME=Talio HRMS
ARG NEXT_PUBLIC_GEMINI_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_ELEVENLABS_API_KEY
ARG NEXT_PUBLIC_ELEVENLABS_VOICE_ID
ARG NEXT_PUBLIC_ELEVENLABS_API_URL

ENV NODE_ENV=production
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV NEXT_PUBLIC_GEMINI_API_KEY=${NEXT_PUBLIC_GEMINI_API_KEY}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}
ENV NEXT_PUBLIC_ELEVENLABS_API_KEY=${NEXT_PUBLIC_ELEVENLABS_API_KEY}
ENV NEXT_PUBLIC_ELEVENLABS_VOICE_ID=${NEXT_PUBLIC_ELEVENLABS_VOICE_ID}
ENV NEXT_PUBLIC_ELEVENLABS_API_URL=${NEXT_PUBLIC_ELEVENLABS_API_URL}
ENV SKIP_ENV_VALIDATION=true

# Build the application
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install only runtime dependencies for sharp
RUN apk add --no-cache vips-dev

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/models ./models
COPY --from=builder /app/.env* ./

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the application
CMD ["node", "server.js"]