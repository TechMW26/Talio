# syntax=docker/dockerfile:1

# ── Stage 1: deps ── ALL dependencies (dev + prod needed for Next.js build) ──
# Use Debian slim instead of Alpine because onnxruntime-node segfaults on musl.
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Native build tools for bcrypt/sharp/node-gyp packages
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# npm install (not ci) so Linux-native optional dependencies are resolved for the
# current container platform even if the lockfile was generated on macOS.
RUN --mount=type=cache,target=/root/.npm \
        npm install --prefer-offline

# ── Stage 2: prod-deps ── Production-only dependencies (no devDeps) ──────────
# Runs in PARALLEL with builder stage — saves ~247s vs npm prune after build.
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline --omit=dev

# ── Stage 3: builder ── Build Next.js production output ──────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# Copy config files first (changes less often → better layer caching)
COPY package.json next.config.js server.js jsconfig.json tailwind.config.js postcss.config.js ./
COPY sentry.server.config.js sentry.edge.config.js instrumentation.js instrumentation-client.js ./

# Copy source (changes most often)
COPY app ./app
COPY components ./components
COPY contexts ./contexts
COPY hooks ./hooks
COPY lib ./lib
COPY models ./models
COPY utils ./utils
COPY config ./config
COPY src ./src
COPY styles ./styles
COPY public ./public

ENV NEXT_TELEMETRY_DISABLED=1 \
    SKIP_ENV_VALIDATION=true \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=4096"

RUN npm run build

# ── Stage 4: runner ── Minimal production image ─────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Production-only node_modules from parallel stage (no devDeps, no prune needed)
COPY --from=prod-deps /app/node_modules ./node_modules

# Build output & server
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.js ./next.config.js

# Runtime source (API routes, lib, models, etc.)
COPY --from=builder /app/app ./app
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/models ./models
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/config ./config
COPY --from=builder /app/src ./src
COPY --from=builder /app/styles ./styles

# Sentry config
COPY --from=builder /app/sentry.server.config.js ./sentry.server.config.js
COPY --from=builder /app/sentry.edge.config.js ./sentry.edge.config.js
COPY --from=builder /app/instrumentation.js ./instrumentation.js
COPY --from=builder /app/instrumentation-client.js ./instrumentation-client.js

# Upload directory (volume-mounted in docker-compose)
RUN mkdir -p ./public/uploads && chown -R nextjs:nodejs ./public/uploads

USER nextjs

EXPOSE 3000

# Custom server with Socket.IO support
CMD ["node", "--max-old-space-size=4096", "server.js"]
