import { headers } from 'next/headers'
import { waitUntil } from '@vercel/functions'
import { createClient } from 'redis'
import { createHash } from 'node:crypto'

// An atomic, bounded fixed window shared by all Vercel instances. Identifiers
// are hashed so email addresses and IPs are not stored in Redis key names.
export async function consumeDistributedRateLimit(identifier, windowMs) {
  try {
    const key = `talio:ratelimit:${createHash('sha256').update(identifier).digest('hex')}`
    const result = await runRemoteCacheOperation(client => client.eval(`
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      return {count, redis.call('PTTL', KEYS[1])}
    `, { keys: [key], arguments: [String(windowMs)] }))
    return Array.isArray(result) ? { count: Number(result[0]), ttlMs: Math.max(0, Number(result[1])) } : null
  } catch {
    return null
  }
}

// ─── L1: In-process memory cache (ultra-fast, short-lived) ───────────────────
// Sits in front of Redis to eliminate network round-trips for repeated reads.
// Default L1 TTL = 8 seconds - long enough to absorb polling bursts,
// short enough that data stays fresh.
const L1_DEFAULT_TTL_S = 8
const L1_MAX_SIZE = 2000
const MEMORY_MAX_SIZE = 5000
const REDIS_RETRY_COOLDOWN_MS = 60 * 1000
const REMOTE_CACHE_BUDGET_MS = Math.max(
  50,
  Number.parseInt(process.env.REDIS_OPERATION_TIMEOUT_MS || '200', 10) || 200
)
const CACHE_TIMEOUT = Symbol('cache-timeout')
const CACHE_UNAVAILABLE = Symbol('cache-unavailable')

const L1_CACHE = global.__l1Cache || new Map()
const L1_TTLS = global.__l1CacheTtls || new Map()
if (!global.__l1Cache) {
  global.__l1Cache = L1_CACHE
  global.__l1CacheTtls = L1_TTLS
}

function l1Get(key) {
  const expiry = L1_TTLS.get(key)
  if (expiry && Date.now() > expiry) {
    L1_CACHE.delete(key)
    L1_TTLS.delete(key)
    return undefined // explicit miss
  }
  return L1_CACHE.has(key) ? L1_CACHE.get(key) : undefined
}

function l1Set(key, value, ttlSeconds) {
  // L1 TTL = min(requested TTL, L1_DEFAULT_TTL_S) - never longer than the Redis TTL
  const l1Ttl = Math.min(ttlSeconds || L1_DEFAULT_TTL_S, L1_DEFAULT_TTL_S)
  L1_CACHE.set(key, value)
  L1_TTLS.set(key, Date.now() + l1Ttl * 1000)
}

function l1Delete(key) {
  L1_CACHE.delete(key)
  L1_TTLS.delete(key)
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function l1ClearPattern(pattern) {
  const regex = globToRegExp(pattern)
  for (const key of L1_CACHE.keys()) {
    if (regex.test(key)) {
      L1_CACHE.delete(key)
      L1_TTLS.delete(key)
    }
  }
}

function l1Clear() {
  L1_CACHE.clear()
  L1_TTLS.clear()
}

async function withinRemoteCacheBudget(promise) {
  let timeoutId
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(CACHE_TIMEOUT), REMOTE_CACHE_BUDGET_MS)
      }),
    ])
  } finally {
    clearTimeout(timeoutId)
  }
}

function markRemoteCacheTimedOut() {
  global.__redisConnectionFailed = true
  global.__redisFailedAt = Date.now()
  global.__redisLastError = `Remote cache exceeded ${REMOTE_CACHE_BUDGET_MS}ms latency budget`
}

async function runRemoteCacheOperation(operation) {
  const result = await withinRemoteCacheBudget((async () => {
    const client = await getRedisClient()
    if (!client) return CACHE_UNAVAILABLE
    return operation(client)
  })())

  if (result === CACHE_TIMEOUT) {
    markRemoteCacheTimedOut()
  }

  return result
}

// Prevent unbounded L1 growth - evict oldest entries when too large
function l1Evict() {
  if (L1_CACHE.size <= L1_MAX_SIZE) return
  const now = Date.now()
  // First pass: remove expired
  for (const [key, expiry] of L1_TTLS) {
    if (now > expiry) { L1_CACHE.delete(key); L1_TTLS.delete(key) }
  }
  // If still too large, remove oldest 25%
  if (L1_CACHE.size > L1_MAX_SIZE) {
    const toRemove = Math.floor(L1_CACHE.size * 0.25)
    let removed = 0
    for (const key of L1_CACHE.keys()) {
      if (removed >= toRemove) break
      L1_CACHE.delete(key); L1_TTLS.delete(key)
      removed++
    }
  }
}

// ─── L2: In-memory fallback (used when Redis unavailable) ────────────────────
const MEMORY_CACHE = global.__memoryCache || new Map()
const MEMORY_TTLS = global.__memoryCacheTtls || new Map()

if (!global.__memoryCache) {
  global.__memoryCache = MEMORY_CACHE
  global.__memoryCacheTtls = MEMORY_TTLS
}

// Track Redis connection state to prevent error spam
if (typeof global.__redisConnectionFailed === 'undefined') {
  global.__redisConnectionFailed = false
  global.__redisErrorLogged = false
  global.__redisConnectedAt = null
  global.__redisLastError = null
  global.__redisFailedAt = 0
}
if (typeof global.__redisFailedAt === 'undefined') {
  global.__redisFailedAt = 0
}

function getRedisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL
  if (process.env.REDIS_HOST) {
    const port = process.env.REDIS_PORT || 6379
    const username = process.env.REDIS_USERNAME ? encodeURIComponent(process.env.REDIS_USERNAME) : ''
    const password = process.env.REDIS_PASSWORD ? encodeURIComponent(process.env.REDIS_PASSWORD) : ''
    const auth = username || password ? `${username}${password ? `:${password}` : ''}@` : ''
    return `redis://${auth}${process.env.REDIS_HOST}:${port}`
  }
  return null
}

function getRedisCaCertificate() {
  if (process.env.REDIS_CA_CERT_BASE64) {
    return Buffer.from(process.env.REDIS_CA_CERT_BASE64, 'base64').toString('utf8')
  }

  if (process.env.REDIS_CA_CERT) {
    return process.env.REDIS_CA_CERT.replace(/\\n/g, '\n')
  }

  return undefined
}

async function getRedisClient() {
  // A connection that completed after an earlier timeout is safe to reuse.
  if (global.__redisClient && global.__redisClient.isReady) {
    global.__redisConnectionFailed = false
    return global.__redisClient
  }

  // Back off after a failure, then retry automatically. A permanent failure
  // flag made transient Redis outages degrade the process until restart.
  if (global.__redisConnectionFailed) {
    const failedAt = global.__redisFailedAt || 0
    if (Date.now() - failedAt < REDIS_RETRY_COOLDOWN_MS) {
      return null
    }
    global.__redisConnectionFailed = false
    global.__redisErrorLogged = false
  }

  // Return in-progress connection promise
  if (global.__redisClientPromise) {
    return global.__redisClientPromise
  }

  const redisUrl = getRedisUrl()
  if (!redisUrl) {
    // No Redis configured - silently use memory cache
    return null
  }

  global.__redisClientPromise = (async () => {
    try {
      const useTls = redisUrl.startsWith('rediss://')
      const ca = useTls ? getRedisCaCertificate() : undefined
      const client = createClient({
        url: redisUrl,
        socket: {
          // The request path has its own strict latency budget. Keep the
          // transport timeout bounded too so abandoned cold connects do not
          // occupy a serverless instance for 15 seconds.
          connectTimeout: Math.max(
            500,
            Number.parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '3000', 10) || 3000
          ),
          keepAlive: 30000,
          // Redis Cloud Essentials uses a private CA when TLS is required.
          // Supplying that CA preserves certificate verification on Vercel;
          // never fall back to rejectUnauthorized: false.
          tls: useTls,
          ...(ca ? { ca, rejectUnauthorized: true } : {}),
          reconnectStrategy: (retries) => {
            if (retries > 8) {
              global.__redisConnectionFailed = true
              global.__redisFailedAt = Date.now()
              global.__redisClientPromise = null
              console.warn('[Cache] Redis max retries exceeded, switching to memory cache')
              return false
            }
            // Exponential back-off capped at 5 s
            const delay = Math.min(retries * 250, 5000)
            console.log(`[Cache] Redis reconnect attempt ${retries}, waiting ${delay}ms`)
            return delay
          }
        },
        // Allow a generous command queue for bursts
        commandsQueueMaxLength: 1000,
        // Disable legacy mode (v4 default is already false)
        legacyMode: false,
      })

      client.on('error', (error) => {
        global.__redisLastError = error.message
        if (!global.__redisErrorLogged) {
          console.warn('[Cache] Redis error, falling back to memory cache:', error.code || error.message)
          global.__redisErrorLogged = true
        }
      })

      client.on('ready', () => {
        console.log('✅ [Cache] Redis connected to Redis Cloud')
        global.__redisConnectionFailed = false
        global.__redisErrorLogged = false
        global.__redisConnectedAt = new Date().toISOString()
        global.__redisLastError = null
        global.__redisFailedAt = 0
      })

      client.on('reconnecting', () => {
        console.log('[Cache] Redis reconnecting...')
      })

      client.on('end', () => {
        console.log('[Cache] Redis connection closed')
        global.__redisClient = null
        global.__redisClientPromise = null
      })

      await client.connect()
      global.__redisClient = client
      global.__redisClientPromise = null
      return client
    } catch (error) {
      if (!global.__redisErrorLogged) {
        console.warn('[Cache] Redis connection failed, using memory cache:', error.code || error.message)
        global.__redisErrorLogged = true
      }
      global.__redisLastError = error.message
      global.__redisConnectionFailed = true
      global.__redisFailedAt = Date.now()
      global.__redisClientPromise = null
      global.__redisClient = null
      return null
    }
  })()

  return global.__redisClientPromise
}

function encodeParams(params) {
  if (!params) return 'base'
  const raw = JSON.stringify(params)
  return Buffer.from(raw)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export function buildCacheKey({ tenantId, role, userId, namespace, params }) {
  const safeTenant = tenantId || 'unknown'
  const safeRole = role || 'any'
  const safeUser = userId || 'all'
  const safeNamespace = namespace || 'default'
  const encodedParams = encodeParams(params)

  return `tenant:${safeTenant}:role:${safeRole}:user:${safeUser}:${safeNamespace}:${encodedParams}`
}

export function buildCachePattern({ tenantId, role = '*', userId = '*', namespace }) {
  const safeTenant = tenantId || '*'
  const safeRole = role || '*'
  const safeUser = userId || '*'
  const safeNamespace = namespace || '*'

  return `tenant:${safeTenant}:role:${safeRole}:user:${safeUser}:${safeNamespace}:*`
}

function memoryGet(key) {
  const ttl = MEMORY_TTLS.get(key)
  if (ttl && Date.now() > ttl) {
    MEMORY_CACHE.delete(key)
    MEMORY_TTLS.delete(key)
    return null
  }
  return MEMORY_CACHE.has(key) ? MEMORY_CACHE.get(key) : null
}

function memorySet(key, value, ttlSeconds) {
  MEMORY_CACHE.set(key, value)
  MEMORY_TTLS.set(key, Date.now() + ttlSeconds * 1000)
  if (MEMORY_CACHE.size <= MEMORY_MAX_SIZE) return

  const now = Date.now()
  for (const [cachedKey, expiry] of MEMORY_TTLS) {
    if (expiry <= now) {
      MEMORY_CACHE.delete(cachedKey)
      MEMORY_TTLS.delete(cachedKey)
    }
  }

  while (MEMORY_CACHE.size > MEMORY_MAX_SIZE) {
    const oldestKey = MEMORY_CACHE.keys().next().value
    if (oldestKey === undefined) break
    MEMORY_CACHE.delete(oldestKey)
    MEMORY_TTLS.delete(oldestKey)
  }
}

function memoryDelete(key) {
  MEMORY_CACHE.delete(key)
  MEMORY_TTLS.delete(key)
}

function memoryClearPattern(pattern) {
  const regex = globToRegExp(pattern)
  for (const key of MEMORY_CACHE.keys()) {
    if (regex.test(key)) {
      MEMORY_CACHE.delete(key)
      MEMORY_TTLS.delete(key)
    }
  }
}

async function shouldBypassRequestCache() {
  try {
    const requestHeaders = await headers()
    const forceFreshHeader = requestHeaders.get('x-talio-force-fresh')
    if (forceFreshHeader === '1') {
      return true
    }

    const cacheControl = requestHeaders.get('cache-control') || ''
    const pragma = requestHeaders.get('pragma') || ''

    return /no-cache|no-store|max-age=0/i.test(cacheControl) || /no-cache/i.test(pragma)
  } catch {
    return false
  }
}

export async function getCache(key, { respectRequestBypass = true } = {}) {
  if (respectRequestBypass && await shouldBypassRequestCache()) {
    return null
  }

  // L1 check - 0ms, no network
  const l1 = l1Get(key)
  if (l1 !== undefined) return l1

  // L2: Redis
  try {
    const value = await runRemoteCacheOperation(client => client.get(key))
    if (typeof value === 'string') {
      const parsed = JSON.parse(value)
      l1Set(key, parsed) // Promote to L1
      return parsed
    }
    // A real Redis miss is authoritative. Falling through to process memory
    // here could resurrect a value invalidated by a different Vercel instance.
    if (value === null) return null
  } catch {
    // Silently fall back to memory cache
  }

  // L3: memory fallback (no Redis)
  const mem = memoryGet(key)
  if (mem !== null) l1Set(key, mem)
  return mem
}

export function setCache(key, value, ttlSeconds = 60) {
  // Always write to local tiers immediately. If Redis later becomes
  // unavailable, warm serverless instances can still serve the same value.
  l1Set(key, value, ttlSeconds)
  l1Evict()
  memorySet(key, value, ttlSeconds)

  const remoteWrite = runRemoteCacheOperation(client =>
      client.set(key, JSON.stringify(value), { EX: ttlSeconds })
    ).catch(() => {
      // Local cache was already populated above.
    })

  // Vercel can freeze a Function as soon as its response is sent. Keep the
  // distributed write alive without adding Redis latency to the response.
  if (process.env.VERCEL === '1') {
    try {
      waitUntil(remoteWrite)
      return Promise.resolve()
    } catch {
      // Local/custom runtimes may not expose a request context.
    }
  }

  return remoteWrite
}

export async function deleteCache(key) {
  l1Delete(key) // Invalidate L1 immediately
  memoryDelete(key)

  try {
    await runRemoteCacheOperation(client => client.del(key))
  } catch {
    // Local tiers were already invalidated above.
  }
}

export async function clearCachePattern(pattern) {
  l1ClearPattern(pattern) // Invalidate L1 immediately
  memoryClearPattern(pattern)

  try {
    await runRemoteCacheOperation(async client => {
      let cursor = 0
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 })
        cursor = result.cursor
        if (result.keys.length > 0) {
          await client.del(result.keys)
        }
      } while (cursor !== 0)
      return true
    })
  } catch {
    // Local tiers were already invalidated above.
  }
}

/**
 * Check if Redis is available and connected
 * @returns {Promise<boolean>}
 */
export async function isRedisConnected() {
  if (global.__redisClient?.isReady) return true
  if (global.__redisConnectionFailed || !getRedisUrl()) return false
  try {
    const ready = await runRemoteCacheOperation(client => client.isReady === true)
    return ready === true
  } catch {
    return false
  }
}

/**
 * Reset Redis connection state (useful for retry after fixing config)
 */
export function resetRedisConnection() {
  global.__redisConnectionFailed = false
  global.__redisErrorLogged = false
  global.__redisClientPromise = null
  global.__redisClient = null
  global.__redisConnectedAt = null
  global.__redisLastError = null
  global.__redisFailedAt = 0
}

/**
 * Flush all keys from Redis (for testing/maintenance)
 * @returns {Promise<boolean>}
 */
export async function flushAllCaches() {
  // Clear all tiers
  l1Clear()
  MEMORY_CACHE.clear()
  MEMORY_TTLS.clear()

  try {
    const result = await runRemoteCacheOperation(client => client.flushDb())
    return result !== CACHE_UNAVAILABLE && result !== CACHE_TIMEOUT
  } catch {
    // ignore
  }
  return false
}

/**
 * Get Redis connection metadata for health/status endpoints
 * @returns {Promise<Object>}
 */
export async function getRedisInfo() {
  const connected = await isRedisConnected()
  const redisUrl = getRedisUrl()

  let info = null
  if (connected) {
    try {
      const raw = await runRemoteCacheOperation(client => client.info('server'))
      if (!raw || raw === CACHE_TIMEOUT || raw === CACHE_UNAVAILABLE) {
        throw new Error('Redis info unavailable')
      }
      const lines = raw.split('\r\n')
      const get = (key) => lines.find(l => l.startsWith(key + ':'))?.split(':')[1]?.trim()
      info = {
        redisVersion: get('redis_version'),
        mode: get('redis_mode'),
        uptimeSeconds: get('uptime_in_seconds'),
        usedMemory: get('used_memory_human'),
        maxMemory: get('maxmemory_human'),
        connectedClients: get('connected_clients'),
      }
    } catch {
      // info not critical
    }
  }

  return {
    connected,
    configured: !!redisUrl,
    type: redisUrl ? 'redis' : 'memory',
    host: redisUrl ? redisUrl.replace(/\/\/[^@]*@/, '//***:***@') : null,
    connectedAt: global.__redisConnectedAt || null,
    lastError: global.__redisLastError || null,
    connectionFailed: global.__redisConnectionFailed,
    l1CacheSize: L1_CACHE.size,
    ...(info ? { serverInfo: info } : {}),
  }
}
