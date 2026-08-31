import {
  acquireMongoLease,
  releaseMongoLease,
  withMongoLease,
} from '@/lib/platform/distributedLease'

function fakeCollection({ duplicate = false } = {}) {
  return {
    findOneAndUpdate: jest.fn(async (_query, update) => {
      if (duplicate) throw Object.assign(new Error('duplicate key'), { code: 11000 })
      return { _id: 'job', ...update.$set }
    }),
    deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
  }
}

describe('Mongo-backed distributed leases', () => {
  test('acquires and releases a bounded lease', async () => {
    const collection = fakeCollection()
    const lease = await acquireMongoLease(collection, 'job', { owner: 'worker-1', ttlMs: 1000 })

    expect(lease).toMatchObject({ key: 'job', owner: 'worker-1' })
    await expect(releaseMongoLease(collection, lease)).resolves.toBe(true)
    expect(collection.deleteOne).toHaveBeenCalledWith({ _id: 'job', owner: 'worker-1' })
  })

  test('treats duplicate-key contention as a skipped run', async () => {
    await expect(acquireMongoLease(fakeCollection({ duplicate: true }), 'job', { owner: 'worker-2' }))
      .resolves.toBeNull()
  })

  test('always releases after a task failure', async () => {
    const collection = fakeCollection()
    await expect(withMongoLease(collection, 'job', { owner: 'worker-3' }, async () => {
      throw new Error('task failed')
    })).rejects.toThrow('task failed')
    expect(collection.deleteOne).toHaveBeenCalledTimes(1)
  })
})
