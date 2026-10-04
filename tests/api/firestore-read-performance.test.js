jest.mock('@/lib/teamViews.server', () => ({ TEAM_VIEW_OPTIONS: { queryFields: { employees: [] } } }))
jest.mock('@/lib/tasks.server', () => ({ taskHandler: fn => fn }))
jest.mock('@/lib/organization.server', () => ({}))
jest.mock('@/lib/companyFeatures.server', () => ({}))
jest.mock('@/lib/communicationsStore.server', () => ({}))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({}))

import { readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { dashboardEmployee } from '@/lib/dashboardData.server'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('reference reads overlap at most three 100-record batches and preserve order', async () => {
  const pending = []
  const database = { getMany: jest.fn((collection, ids) => {
    const item = deferred()
    pending.push({ ...item, records: ids.map(_id => ({ _id, tenant: 'first' })) })
    return item.promise
  }) }
  const ids = Array.from({ length: 405 }, (_, index) => String(index))
  const result = readFirestoreReferences(database, 'employees', [...ids, '0', null])
  expect(database.getMany).toHaveBeenCalledTimes(3)
  expect(database.getMany.mock.calls.every(([name, batch]) => name === 'employees' && batch.length === 100)).toBe(true)
  pending[2].resolve(pending[2].records)
  pending[1].resolve(pending[1].records)
  await Promise.resolve()
  expect(database.getMany).toHaveBeenCalledTimes(3)
  pending[0].resolve(pending[0].records)
  await new Promise(resolve => setImmediate(resolve))
  expect(database.getMany).toHaveBeenCalledTimes(5)
  pending[4].resolve(pending[4].records)
  pending[3].resolve(pending[3].records)
  expect([...(await result).keys()]).toEqual(ids)
})

test('reference reads do not cache across tenant stores, filter missing records, and propagate failure', async () => {
  const first = { getMany: jest.fn(async () => [{ _id: 'same', tenant: 'first' }, null]) }
  const second = { getMany: jest.fn(async () => [{ _id: 'same', tenant: 'second' }]) }
  expect((await readFirestoreReferences(first, 'employees', ['same', 'missing'])).get('same').tenant).toBe('first')
  expect((await readFirestoreReferences(second, 'employees', ['same'])).get('same').tenant).toBe('second')
  const failed = { getMany: jest.fn().mockRejectedValue(new Error('Unavailable')) }
  await expect(readFirestoreReferences(failed, 'employees', Array.from({ length: 400 }, (_, i) => String(i)))).rejects.toThrow('Unavailable')
  expect(failed.getMany).toHaveBeenCalledTimes(3)
  expect(await readFirestoreReferences(first, 'employees', [])).toEqual(new Map())
})

test('dashboard employee relationships start together without waiting for earlier reads', async () => {
  const pending = []
  const row = { _id: 'employee', designation: 'designation', department: 'department', departments: ['department'], reportingManager: 'manager' }
  const database = {
    get: jest.fn((collection, recordId) => {
      if (recordId === 'employee') return Promise.resolve(row)
      const item = deferred(); pending.push({ ...item, recordId }); return item.promise
    }),
    getMany: jest.fn(async () => [{ _id: 'department' }]),
  }
  const result = dashboardEmployee(database, 'employee')
  await Promise.resolve()
  expect(database.get).toHaveBeenCalledTimes(4)
  expect(database.getMany).toHaveBeenCalledTimes(1)
  for (const item of pending) item.resolve({ _id: item.recordId, firstName: 'Manager' })
  expect(await result).toMatchObject({ _id: 'employee', designation: { _id: 'designation' }, department: { _id: 'department' }, departments: [{ _id: 'department' }], reportingManager: { _id: 'manager' } })
})

test('missing dashboard employee does not read relationships', async () => {
  const database = { get: jest.fn(async () => null), getMany: jest.fn() }
  expect(await dashboardEmployee(database, 'missing')).toBeNull()
  expect(database.get).toHaveBeenCalledTimes(1)
  expect(database.getMany).not.toHaveBeenCalled()
})
