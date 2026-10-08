import { createHash } from 'node:crypto'
import { getCache, setCache } from './cache'

const pending = new Map()
const TTL_MS = 15000

// Call only after fresh authentication and team/profile scope resolution.
// Cache presentation aggregates, never authorization or transactional state.
export async function cachedDashboardStats(request, auth, kind, scope, load) {
  if (!auth.database?.databaseName || !auth.user) return load()
  const bypass = request.headers.get('x-force-fresh') === '1'
    || /no-cache|no-store|max-age=0/i.test(request.headers.get('cache-control') || '')
    || /no-cache/i.test(request.headers.get('pragma') || '')
  if (bypass) return load()
  const fingerprint = JSON.stringify([
    process.env.FIRESTORE_PROJECT_ID, process.env.FIRESTORE_DATABASE_ID || '(default)',
    process.env.FIRESTORE_DATASET, auth.database.databaseName, kind, auth.user, scope,
    new Date().toISOString().slice(0, 10),
  ])
  const key = `talio:dashboard-stats:v1:${createHash('sha256').update(fingerprint).digest('hex')}`
  const cached = await getCache(key)
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
