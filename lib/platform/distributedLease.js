import { randomUUID } from 'crypto'

export async function acquireMongoLease(collection, key, {
  ttlMs = 5 * 60 * 1000,
  owner = randomUUID(),
  now = new Date(),
} = {}) {
  const expiresAt = new Date(now.getTime() + ttlMs)

  try {
    const lease = await collection.findOneAndUpdate(
      {
        _id: key,
        $or: [
          { expiresAt: { $lte: now } },
          { owner },
        ],
      },
      {
        $set: { owner, expiresAt, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    )

    return lease?.owner === owner ? { key, owner, expiresAt } : null
  } catch (error) {
    // An unexpired lease fails the upsert on the unique _id. That is ordinary
    // contention, not an application error.
    if (error?.code === 11000) return null
    throw error
  }
}

export async function releaseMongoLease(collection, lease) {
  if (!lease) return false
  const result = await collection.deleteOne({ _id: lease.key, owner: lease.owner })
  return result.deletedCount === 1
}

export async function withMongoLease(collection, key, options, task) {
  const lease = await acquireMongoLease(collection, key, options)
  if (!lease) return { acquired: false, value: null }

  try {
    return { acquired: true, value: await task(lease) }
  } finally {
    await releaseMongoLease(collection, lease).catch((error) => {
      console.error(`[DistributedLease] Failed to release ${key}:`, error.message)
    })
  }
}
