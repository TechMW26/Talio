import { createClient } from 'redis'

// In-memory cache (fallback when Redis unavailable)
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

  // Return existing connection promise
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
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            // Only retry 3 times, then give up
            if (retries > 3) {
              global.__redisConnectionFailed = true
              return false
            }
            return Math.min(retries * 100, 1000)
          }
        }
      })

      // Only log errors once to prevent spam
      client.on('error', (error) => {
        if (!global.__redisErrorLogged) {
          console.warn('[Cache] Redis unavailable, using memory cache:', error.code || error.message)
          global.__redisErrorLogged = true
        }
      })

      client.on('ready', () => {
        console.log('✅ [Cache] Redis connected')
        global.__redisConnectionFailed = false
        global.__redisErrorLogged = false
      })

      await client.connect()
      return client
    } catch (error) {
      if (!global.__redisErrorLogged) {
        console.warn('[Cache] Redis connection failed, using memory cache:', error.code || error.message)
        global.__redisErrorLogged = true
      }
      global.__redisConnectionFailed = true
      global.__redisClientPromise = null
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
  try {
    const client = await getRedisClient()
    if (client) {
      const value = await client.get(key)
      return value ? JSON.parse(value) : null
    }
  } catch {
    // Silently fall back to memory cache
  }

  return memoryGet(key)
}

export async function setCache(key, value, ttlSeconds = 60) {
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
    return client !== null
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
}