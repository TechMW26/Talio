import { executeMiraActionOnce, readMiraActionReceipt } from '@/lib/miraActionReceipt.server'
import { createMiraReminder } from '@/lib/miraReminder.server'

function memoryDatabase() {
  const rows = new Map()
  let tail = Promise.resolve()
  const copy = value => value ? structuredClone(value) : null
  const database = { databaseName: 'talio_company_A', get: jest.fn(async (name, id) => copy(rows.get(`${name}:${id}`))), transaction: jest.fn(async callback => {
    let release
    const previous = tail
    tail = new Promise(resolve => { release = resolve })
    await previous
    try {
      return await callback({
        get: async (name, id) => copy(rows.get(`${name}:${id}`)),
        create: async (name, value) => {
          const key = `${name}:${value._id}`
          if (rows.has(key)) throw new Error('Duplicate record')
          rows.set(key, copy(value))
        },
        replace: async (name, value) => { rows.set(`${name}:${value._id}`, copy(value)) },
      })
    } finally { release() }
  }) }
  return { database, rows }
}
const input = { tenant: 'talio_company_A', owner: 'user-A', requestId: 'turn-1:task-A', action: { type: 'create_task', fields: { title: 'Review draft', assignees: ['me'] } } }
const success = () => ({ status: 201, body: { success: true, message: 'Created', resource: { page: 'tasks', id: '507f1f77bcf86cd799439011' } } })

test('a concurrent duplicate cannot execute while the committed claim is pending', async () => {
  const { database, rows } = memoryDatabase()
  let release, entered
  const waiting = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const execute = jest.fn(async () => { entered(); await waiting; return success() })
  const first = executeMiraActionOnce({ ...input, database }, execute)
  await started
  expect([...rows.values()][0].status).toBe('pending')
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toMatchObject({ status: 409, body: { success: false, uncertain: true } })
  expect(execute).toHaveBeenCalledTimes(1)
  release()
  expect(await first).toEqual(success())
})

test('completed receipts preserve HTTP status/body, isolate cache values, and normalize object key order', async () => {
  const { database } = memoryDatabase(), execute = jest.fn(async () => success())
  const original = await executeMiraActionOnce({ ...input, database }, execute)
  const replay = await executeMiraActionOnce({ ...input, action: { fields: { assignees: ['me'], title: 'Review draft' }, type: 'create_task' }, database }, execute)
  expect(replay).toEqual(original)
  replay.body.resource.id = 'changed-locally'
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toEqual(success())
  expect(execute).toHaveBeenCalledTimes(1)
})

test('a reused request identity with another payload fails closed', async () => {
  const { database } = memoryDatabase(), execute = jest.fn(async () => success())
  await executeMiraActionOnce({ ...input, database }, execute)
  expect(await executeMiraActionOnce({ ...input, database, action: { ...input.action, fields: { title: 'Different task' } } }, execute)).toMatchObject({ status: 409, body: { success: false } })
  expect(execute).toHaveBeenCalledTimes(1)
})

test('claims are scoped to authenticated tenant and account, not merely the request identity', async () => {
  const { database } = memoryDatabase(), execute = jest.fn(async () => success())
  for (const scope of [{}, { owner: 'user-B' }, { tenant: 'talio_company_B' }]) await executeMiraActionOnce({ ...input, ...scope, database }, execute)
  expect(execute).toHaveBeenCalledTimes(3)
})

test('a delegate interruption after an effect is uncertain and can never be reclaimed', async () => {
  const { database, rows } = memoryDatabase(), execute = jest.fn(async () => { throw new Error('Connection reset after write') })
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toMatchObject({ status: 503, body: { success: false, uncertain: true } })
  const row = [...rows.values()][0]
  expect(row.status).toBe('uncertain')
  row.createdAt = new Date('2000-01-01')
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toMatchObject({ status: 409, body: { uncertain: true } })
  expect(execute).toHaveBeenCalledTimes(1)
})

test('failure to save the final receipt preserves a non-replayable pending claim', async () => {
  const { database, rows } = memoryDatabase(), execute = jest.fn(async () => success())
  const transaction = database.transaction
  let calls = 0
  database.transaction = jest.fn(async callback => { if (++calls === 2) throw new Error('Database disconnected'); return transaction(callback) })
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toMatchObject({ status: 503, body: { uncertain: true } })
  expect([...rows.values()][0].status).toBe('pending')
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toMatchObject({ status: 409, body: { uncertain: true } })
  expect(execute).toHaveBeenCalledTimes(1)
})

test('claim-store failure cannot invoke a delegate whose claim ownership is unknown', async () => {
  const database = { transaction: jest.fn(async () => { throw new Error('Claim response lost') }) }, execute = jest.fn(async () => success())
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toMatchObject({ status: 503, body: { uncertain: true } })
  expect(execute).not.toHaveBeenCalled()
})

test('known failed results are cached rather than retried with the same identity', async () => {
  const { database } = memoryDatabase(), result = { status: 403, body: { success: false, message: 'Not allowed' } }
  const execute = jest.fn(async () => result)
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toEqual(result)
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toEqual(result)
  expect(execute).toHaveBeenCalledTimes(1)
})

test.each([null, '', '   ', 42, 'a'.repeat(201), 'line\nbreak'])('invalid request identity %p never reads receipts or calls a delegate', async requestId => {
  const { database } = memoryDatabase(), execute = jest.fn()
  await expect(executeMiraActionOnce({ ...input, requestId, database }, execute)).rejects.toMatchObject({ status: 400 })
  expect(database.transaction).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

test('an absent identity remains backward compatible without a receipt database', async () => {
  expect(await executeMiraActionOnce({ action: input.action }, async () => success())).toEqual(success())
})

test('aborted work does not call the delegate and its claim remains non-replayable', async () => {
  const { database } = memoryDatabase(), execute = jest.fn(async () => success())
  const controller = new AbortController(); controller.abort()
  expect(await executeMiraActionOnce({ ...input, database, signal: controller.signal }, execute)).toMatchObject({ status: 503, body: { uncertain: true } })
  expect(await executeMiraActionOnce({ ...input, database }, execute)).toMatchObject({ status: 409, body: { uncertain: true } })
  expect(execute).not.toHaveBeenCalled()
})

test('a real Mira reminder creation is read back by the same deterministic identity without a new write', async () => {
  const { database, rows } = memoryDatabase()
  rows.set('users:user-A', { _id: 'user-A', employeeId: 'employee-A', isActive: true })
  const fields = { message: 'Review the answer', scheduledFor: '2099-01-01T09:00:00.000Z', timezone: 'Asia/Kolkata' }
  const created = await createMiraReminder(database, { _id: 'user-A' }, fields, input.requestId)
  const writesBefore = database.transaction.mock.calls.length
  expect(await readMiraActionReceipt({ database, tenant: input.tenant, owner: input.owner, requestId: input.requestId, type: 'schedule_reminder' })).toMatchObject({
    success: true, found: true, state: 'completed', outcome: { success: true, reminder: { id: created._id, scheduledFor: fields.scheduledFor, timezone: fields.timezone } },
  })
  expect(database.transaction).toHaveBeenCalledTimes(writesBefore)
  expect(rows.size).toBe(2)
})
