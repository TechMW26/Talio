import { randomUUID } from 'crypto'

const COLLECTION = 'backgroundJobLeases'

export async function acquireFirestoreLease(database, key, {
  ttlMs = 5 * 60 * 1000,
  owner = randomUUID(),
  now = new Date(),
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 24 * 60 * 60 * 1000 || typeof owner !== 'string' || !owner) throw new TypeError('Invalid lease options')
  const expiresAt = new Date(now.getTime() + ttlMs)
  return database.transaction(async tx => {
    const existing = await tx.get(COLLECTION, key)
    if (existing && new Date(existing.expiresAt) > now && existing.owner !== owner) return null
    const lease = { _id: key, owner, expiresAt, updatedAt: now, createdAt: existing?.createdAt || now }
    if (existing) await tx.replace(COLLECTION, lease)
    else await tx.create(COLLECTION, lease)
    return { key, owner, expiresAt }
  })
}

export async function releaseFirestoreLease(database, lease) {
  if (!lease) return false
  return database.transaction(async tx => {
    const current = await tx.get(COLLECTION, lease.key)
    if (!current || current.owner !== lease.owner) return false
    await tx.delete(COLLECTION, lease.key)
    return true
  })
}

export async function withFirestoreLease(database, key, options, task) {
  const lease = await acquireFirestoreLease(database, key, options)
  if (!lease) return { acquired: false, value: null }

  try {
    return { acquired: true, value: await task(lease) }
  } finally {
    await releaseFirestoreLease(database, lease).catch((error) => {
      console.error('[DistributedLease] Failed to release job lease:', error.code || 'release-failed')
    })
  }
}
