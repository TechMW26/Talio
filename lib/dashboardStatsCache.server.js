import { createHash } from 'node:crypto'
import { getCache, setCache } from './cache'

const pending = new Map()
const TTL_MS = 15000

// Call only after fresh authentication and team/profile scope resolution.
// Cache presentation aggregates, never authorization or transactional state.
export async function cachedDashboardStats(request, auth, kind, scope, load) {
  if (!auth.database?.databaseName || !auth.user) return load()
  // Browser no-store disables HTTP caching on every dashboard request; only
  // the explicit mutation/manual-refresh signal bypasses this server cache.
  const bypass = request.headers.get('x-talio-force-fresh') === '1'
    || request.headers.get('x-force-fresh') === '1'
  if (bypass) return load()
  const fingerprint = JSON.stringify([
    'mongodb', process.env.MONGODB_DATABASE, process.env.MONGODB_DATASET,
    auth.database.databaseName, kind, auth.user, scope,
    new Date().toISOString().slice(0, 10),
  ])
  const key = `talio:dashboard-stats:v2:${createHash('sha256').update(fingerprint).digest('hex')}`
  const cached = await getCache(key, { respectRequestBypass: false })
  if (cached?.expiresAt > Date.now()) return cached.value
  if (pending.has(key)) return pending.get(key)
  const work = (async () => {
    const expiresAt = Date.now() + TTL_MS
    const value = await load()
    // Failed or excessively slow computations must not become cached successes.
    if (value?.success === true && expiresAt > Date.now()) {
      await setCache(key, { value, expiresAt }, Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)))
    }
    return value
  })()
  pending.set(key, work)
  try { return await work } finally { if (pending.get(key) === work) pending.delete(key) }
}
