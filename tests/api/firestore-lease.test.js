import {
  acquireFirestoreLease,
  releaseFirestoreLease,
  withFirestoreLease,
} from '@/lib/platform/firestoreLease.server'

function fakeDatabase({ occupied = false } = {}) {
  let record = occupied ? { _id: 'job', owner: 'other', expiresAt: new Date(Date.now() + 100000) } : null
  const tx = {
    get: jest.fn(async () => record),
    create: jest.fn(async (_collection, value) => { record = value }),
    replace: jest.fn(async (_collection, value) => { record = value }),
    delete: jest.fn(async () => { record = null }),
  }
  return { ...tx, transaction: jest.fn(callback => callback(tx)) }
}

describe('Firestore transactional distributed leases', () => {
  test('acquires and releases a bounded lease', async () => {
    const database = fakeDatabase()
    const lease = await acquireFirestoreLease(database, 'job', { owner: 'worker-1', ttlMs: 1000 })

    expect(lease).toMatchObject({ key: 'job', owner: 'worker-1' })
    await expect(releaseFirestoreLease(database, lease)).resolves.toBe(true)
    expect(database.delete).toHaveBeenCalledWith('backgroundJobLeases', 'job')
  })

  test('treats an unexpired lease owned by another worker as a skipped run', async () => {
    await expect(acquireFirestoreLease(fakeDatabase({ occupied: true }), 'job', { owner: 'worker-2' }))
      .resolves.toBeNull()
  })

  test('always releases after a task failure', async () => {
    const database = fakeDatabase()
    await expect(withFirestoreLease(database, 'job', { owner: 'worker-3' }, async () => {
      throw new Error('task failed')
    })).rejects.toThrow('task failed')
    expect(database.delete).toHaveBeenCalledTimes(1)
  })
  test('an old worker cannot release the new owner lease', async () => {
    const database = fakeDatabase({ occupied: true })
    expect(await releaseFirestoreLease(database, { key: 'job', owner: 'old-worker' })).toBe(false)
    expect(database.delete).not.toHaveBeenCalled()
  })
})
