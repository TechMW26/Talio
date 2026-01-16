import { createClient } from 'redis'

const MEMORY_CACHE = global.__memoryCache || new Map()
const MEMORY_TTLS = global.__memoryCacheTtls || new Map()

if (!global.__memoryCache) {
  global.__memoryCache = MEMORY_CACHE
  global.__memoryCacheTtls = MEMORY_TTLS
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
  if (global.__redisClientPromise) {
    return global.__redisClientPromise
  }

  const redisUrl = getRedisUrl()
  if (!redisUrl) return null

  global.__redisClientPromise = (async () => {
    const client = createClient({ url: redisUrl })
    client.on('error', (error) => {
      console.error('[Cache] Redis error:', error)
    })
    await client.connect()
    return client
  })().catch((error) => {
    console.error('[Cache] Redis connect failed:', error)
    global.__redisClientPromise = null
    return null
  })

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
  const regex = new RegExp(pattern)
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
  } catch (error) {
    console.warn('[Cache] Redis get failed, falling back to memory:', error)
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
  } catch (error) {
    console.warn('[Cache] Redis set failed, falling back to memory:', error)
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
  } catch (error) {
    console.warn('[Cache] Redis delete failed, falling back to memory:', error)
  }

  memoryDelete(key)
}

export async function clearCachePattern(pattern) {
  try {
    const client = await getRedisClient()
    if (client) {
      let cursor = '0'
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 })
        cursor = result.cursor
        if (result.keys.length > 0) {
          await client.del(result.keys)
        }
      } while (cursor !== '0')
      return
    }
  } catch (error) {
    console.warn('[Cache] Redis scan failed, falling back to memory:', error)
  }

  memoryClearPattern(pattern)
}