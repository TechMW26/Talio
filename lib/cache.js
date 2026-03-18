import { createClient } from 'redis'

// ─── L1: In-process memory cache (ultra-fast, short-lived) ───────────────────
// Sits in front of Redis to eliminate network round-trips for repeated reads.
// Default L1 TTL = 8 seconds - long enough to absorb polling bursts,
// short enough that data stays fresh.
const L1_DEFAULT_TTL_S = 8

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

function l1ClearPattern(pattern) {
  const regex = new RegExp(pattern.replace(/\*/g, '.*'))
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

// Prevent unbounded L1 growth - evict oldest entries when too large
const L1_MAX_SIZE = 2000
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

async function getRedisClient() {
  // If Redis already failed, don't retry (prevents error spam)
  if (global.__redisConnectionFailed) {
    return null
  }

  // Return existing active client
  if (global.__redisClient && global.__redisClient.isReady) {
    return global.__redisClient
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
      const client = createClient({
        url: redisUrl,
        socket: {
          // Generous timeouts for external Redis Cloud (network latency)
          connectTimeout: 15000,
          keepAlive: 30000,
          // TLS is handled by rediss:// scheme; redis:// = plain TCP
          tls: redisUrl.startsWith('rediss://'),
          reconnectStrategy: (retries) => {
            if (retries > 8) {
              global.__redisConnectionFailed = true
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
  return MEMORY_CACHE.get(key) || null
}

function memorySet(key, value, ttlSeconds) {
  MEMORY_CACHE.set(key, value)
  MEMORY_TTLS.set(key, Date.now() + ttlSeconds * 1000)
}

function memoryDelete(key) {
  MEMORY_CACHE.delete(key)
  MEMORY_TTLS.delete(key)
}

function memoryClearPattern(pattern) {
  const regex = new RegExp(pattern.replace(/\*/g, '.*'))
  for (const key of MEMORY_CACHE.keys()) {
    if (regex.test(key)) {
      MEMORY_CACHE.delete(key)
      MEMORY_TTLS.delete(key)
    }
  }
}

export async function getCache(key) {
  // L1 check - 0ms, no network
  const l1 = l1Get(key)
  if (l1 !== undefined) return l1

  // L2: Redis
  try {
    const client = await getRedisClient()
    if (client) {
      const value = await client.get(key)
      if (value) {
        const parsed = JSON.parse(value)
        l1Set(key, parsed) // Promote to L1
        return parsed
      }
      return null
    }
  } catch {
    // Silently fall back to memory cache
  }

  // L3: memory fallback (no Redis)
  const mem = memoryGet(key)
  if (mem !== null) l1Set(key, mem)
  return mem
}

export async function setCache(key, value, ttlSeconds = 60) {
  // Always write to L1 immediately
  l1Set(key, value, ttlSeconds)
  l1Evict()

  try {
    const client = await getRedisClient()
    if (client) {
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds })
      return
    }
  } catch {
    // Silently fall back to memory cache
  }

  memorySet(key, value, ttlSeconds)
}

export async function deleteCache(key) {
  l1Delete(key) // Invalidate L1 immediately

  try {
    const client = await getRedisClient()
    if (client) {
      await client.del(key)
      return
    }
  } catch {
    // Silently fall back to memory cache
  }

  memoryDelete(key)
}

export async function clearCachePattern(pattern) {
  l1ClearPattern(pattern) // Invalidate L1 immediately

  try {
    const client = await getRedisClient()
    if (client) {
      let cursor = 0
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 })
        cursor = result.cursor
        if (result.keys.length > 0) {
          await client.del(result.keys)
        }
      } while (cursor !== 0)
      return
    }
  } catch {
    // Silently fall back to memory cache
  }

  memoryClearPattern(pattern)
}

/**
 * Check if Redis is available and connected
 * @returns {Promise<boolean>}
 */
export async function isRedisConnected() {
  if (global.__redisConnectionFailed) return false
  try {
    const client = await getRedisClient()
    return client !== null && client.isReady === true
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
    const client = await getRedisClient()
    if (client) {
      await client.flushDb()
      return true
    }
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
      const client = await getRedisClient()
      const raw = await client.info('server')
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