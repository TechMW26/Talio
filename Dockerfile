# syntax=docker/dockerfile:1

# ── Stage 1: deps ── Install ALL dependencies (dev + prod needed for build) ──
FROM node:20-alpine AS deps
WORKDIR /app

# Native build tools for sharp, bcrypt, canvas
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./

# Install from lockfile. We use `npm install` (not `npm ci`) because the
# lockfile was generated on macOS and ci would skip Linux optional deps.
# Then forcibly add the Alpine-specific native binaries that macOS lockfile
# omits - sharp needs both the binding AND libvips for linuxmusl.
RUN --mount=type=cache,target=/root/.npm \
    ARCH=$(node -p "process.arch") && \
    npm install --prefer-offline && \
    npm install --no-save \
      "@img/sharp-linuxmusl-${ARCH}" \
      "@img/sharp-libvips-linuxmusl-${ARCH}" \
      "@rollup/rollup-linux-${ARCH}-musl"

# ── Stage 2: builder ── Build Next.js production output ──────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1 \
    SKIP_ENV_VALIDATION=true \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=4096"

RUN npm run build

# Strip devDependencies - runner only needs production deps
RUN npm prune --omit=dev

# ── Stage 3: runner ── Minimal production image ─────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# libc6-compat needed at runtime for sharp and other native modules
RUN apk add --no-cache libc6-compat && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Build output & server
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.js ./next.config.js

# Runtime source (API routes, lib, models, etc.)
COPY --from=builder /app/app ./app
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/models ./models
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/config ./config
COPY --from=builder /app/scripts ./scripts
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
