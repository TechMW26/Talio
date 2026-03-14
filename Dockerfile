# ---- Stage 1: Install ALL dependencies (needed for build) ----
FROM node:20-alpine AS deps
WORKDIR /app

# Install native build dependencies for sharp, canvas, bcrypt
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts
RUN npm rebuild sharp 2>/dev/null || true
RUN npm rebuild bcryptjs 2>/dev/null || true

# ---- Stage 2: Build the Next.js app ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV SKIP_ENV_VALIDATION=true
ENV NODE_ENV=production

RUN npm run build

# Prune devDependencies after build so runner gets only production deps
RUN npm prune --omit=dev

# ---- Stage 3: Production runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy build output and server
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.js ./next.config.js

# Copy application source needed at runtime (API routes, lib, models, etc.)
COPY --from=builder /app/app ./app
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/models ./models
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/config ./config
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src

# Create upload directory
RUN mkdir -p ./public/uploads && chown -R nextjs:nodejs ./public/uploads

# Sentry config files (if they exist)
COPY --from=builder /app/sentry.server.config.js ./sentry.server.config.js
COPY --from=builder /app/sentry.edge.config.js ./sentry.edge.config.js
COPY --from=builder /app/instrumentation.js ./instrumentation.js
COPY --from=builder /app/instrumentation-client.js ./instrumentation-client.js

USER nextjs

EXPOSE 3000

# Use the custom server (Socket.IO support)
CMD ["node", "--max-old-space-size=4096", "server.js"]
