# syntax=docker/dockerfile:1.7

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

# The lockfile contains Linux SWC/sharp optional packages, so npm ci is both
# deterministic and faster than resolving the dependency tree on every build.
RUN --mount=type=cache,id=talio-npm,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

# ── Stage 2: prod-deps ── Reuse the resolved dependency layer ────────────────
# This runs in parallel with the application build without downloading and
# compiling the complete dependency tree a second time.
FROM deps AS prod-deps
RUN npm prune --omit=dev --no-audit --no-fund

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
    NODE_OPTIONS="--max-old-space-size=8192"

ARG NEXT_BUILD_CPUS

# Keep the multi-gigabyte webpack/SWC cache in BuildKit rather than baking it
# into the builder and runtime layers. It is reused by subsequent builds.
RUN --mount=type=cache,id=talio-next-build,target=/app/.next/cache,sharing=locked \
    npm run build

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

# Upload and release directories (volume-mounted in docker-compose)
RUN mkdir -p ./public/uploads /var/www/talio/releases \
    && chown -R nextjs:nodejs ./public/uploads /var/www/talio

USER nextjs

EXPOSE 3000

# Custom server with Socket.IO support
CMD ["node", "--max-old-space-size=4096", "server.js"]
