import { EventEmitter } from 'events'

const mockCreateConnection = jest.fn()
jest.mock('mongoose', () => ({ __esModule: true, default: { createConnection: (...args) => mockCreateConnection(...args) } }))

describe('superadmin connection lifecycle', () => {
  let db
  let connection
  beforeEach(async () => {
    jest.resetModules()
    delete globalThis.__talioSuperadminConnectionState
    process.env.MONGODB_URI = 'mongodb://localhost/test'
    connection = new EventEmitter()
    connection.readyState = 1
    connection.close = jest.fn().mockResolvedValue()
    connection.asPromise = jest.fn().mockResolvedValue(connection)
    mockCreateConnection.mockReset().mockReturnValue(connection)
    db = await import('@/lib/superadminDb')
  })

  test('100 concurrent cold callers open exactly one pool', async () => {
    const results = await Promise.all(Array.from({ length: 100 }, () => db.connectSuperadminDB()))
    expect(mockCreateConnection).toHaveBeenCalledTimes(1)
    expect(results.every(result => result === connection)).toBe(true)
  })

  test('transient disconnect retains driver; explicit close permits replacement', async () => {
    await db.connectSuperadminDB()
    connection.readyState = 0
    connection.emit('disconnected')
    expect(await db.connectSuperadminDB()).toBe(connection)
    expect(mockCreateConnection).toHaveBeenCalledTimes(1)
    connection.emit('close')
    const replacement = new EventEmitter()
    replacement.asPromise = jest.fn().mockResolvedValue(replacement)
    mockCreateConnection.mockReturnValue(replacement)
    expect(await db.connectSuperadminDB()).toBe(replacement)
    connection.emit('close') // delayed event must not discard new pool
    expect(await db.connectSuperadminDB()).toBe(replacement)
    expect(mockCreateConnection).toHaveBeenCalledTimes(2)
  })

  test('failed initial connection is closed and does not poison the next call', async () => {
    connection.asPromise.mockRejectedValueOnce(new Error('authentication failed'))
    await expect(db.connectSuperadminDB()).rejects.toThrow('authentication failed')
    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(await db.connectSuperadminDB()).toBe(connection)
    expect(mockCreateConnection).toHaveBeenCalledTimes(2)
  })
})
