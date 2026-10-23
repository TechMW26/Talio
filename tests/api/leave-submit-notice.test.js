jest.mock('@/lib/platform/firestoreQueries.server', () => ({
  collectFirestorePages: jest.fn(async (store, name, { filters = [] } = {}) => store.__all(name, filters)),
  readFirestoreReferences: jest.fn(async () => new Map()),
}))

import { submitLeaveRequest } from '@/lib/leaveRequests.server'

const employeeId = '111111111111111111111111'
const leaveTypeId = '222222222222222222222222'
const userId = '333333333333333333333333'

const matches = (record, filters) => filters.every(({ field, operator, value }) => {
  const actual = record[field]
  if (operator === '==') return String(actual?._id ?? actual) === String(value?._id ?? value)
  if (operator === 'in') return value.map(item => String(item)).includes(String(actual))
  if (operator === '>=') return new Date(actual).getTime() >= new Date(value).getTime()
  if (operator === '<=') return new Date(actual).getTime() <= new Date(value).getTime()
  if (operator === '<') return new Date(actual).getTime() < new Date(value).getTime()
  return false
})

function createStore(seed = {}) {
  const data = {
    users: [{ _id: userId, employeeId, role: 'employee', isActive: true }],
    employees: [{
      _id: employeeId, firstName: 'Employee', status: 'active', dateOfJoining: '2026-04-01',
      lifecycle: { offboarding: { resignationDate: '2026-11-15', lastWorkingDay: '2026-12-15' } },
    }],
    leavetypes: [{ _id: leaveTypeId, code: 'CL', name: 'Casual Leave', isActive: true, maxDaysPerYear: 7 }],
    leavebalances: [{ _id: '444444444444444444444444', employee: employeeId, leaveType: leaveTypeId, year: 2026, overrideDays: 20, totalDays: 20, source: 'manual' }],
    leaves: [],
    companysettings: [],
    leaveguards: [],
    ...seed,
  }
  const store = {
    data,
    __all: (name, filters = []) => (data[name] || []).filter(record => matches(record, filters)),
    async get(name, id) { return (data[name] || []).find(record => String(record._id) === String(id)) || null },
    async list(name, { filters = [], limit = 100 } = {}) { return { records: store.__all(name, filters).slice(0, limit), nextCursor: null } },
    async create(name, record) { (data[name] = data[name] || []).push(record); return record },
    async replace(name, record) {
      const collection = (data[name] = data[name] || [])
      const index = collection.findIndex(item => String(item._id) === String(record._id))
      if (index >= 0) collection[index] = record
      else collection.push(record)
      return record
    },
    async transaction(run) { return run(store) },
  }
  return store
}

const actor = { _id: userId, employeeId, role: 'employee' }
const request = (startDate, endDate, extra = {}) => ({ leaveType: 'CL', startDate, endDate, reason: 'Family event', ...extra })

describe('leave submission against the notice period', () => {
  test('rejects the whole request when a single day falls after the last working day', async () => {
    const store = createStore()
    await expect(submitLeaveRequest(store, actor, request('2026-12-14', '2026-12-17')))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('last working day') })
    expect(store.data.leaves).toHaveLength(0)
  })

  test('names the last working day in the rejection', async () => {
    const store = createStore()
    await expect(submitLeaveRequest(store, actor, request('2026-12-16', '2026-12-17')))
      .rejects.toThrow('15 Dec 2026')
    expect(store.data.leaves).toHaveLength(0)
  })

  test('splits a request that crosses the notice start into paid and LWP records', async () => {
    const store = createStore()
    const result = await submitLeaveRequest(store, actor, request('2026-11-10', '2026-11-20'))

    expect(result.split).toMatchObject({ paidDays: 5, lwpDays: 5 })
    expect(result.split.parts.map(part => [part.segment, part.startDate.toISOString().slice(0, 10), part.endDate.toISOString().slice(0, 10), part.days])).toEqual([
      ['leave', '2026-11-10', '2026-11-14', 5],
      ['lwp', '2026-11-15', '2026-11-20', 5],
    ])

    expect(store.data.leaves).toHaveLength(2)
    expect(store.data.leaves.map(record => record.leaveType)).toEqual(['CL', 'LWP'])
    expect(store.data.leaves.map(record => record.leaveTypeName)).toEqual(['Casual Leave', 'Leave Without Pay'])
    expect(store.data.leaves[1]).toMatchObject({ isLeaveWithoutPay: true, status: 'pending' })
    expect(store.data.leaves[0].splitGroup).toBe(store.data.leaves[1].splitGroup)
    expect(store.data.leavetypes.map(type => type.code)).toContain('LWP')
  })

  test('charges only the paid part against the balance', async () => {
    const store = createStore()
    await submitLeaveRequest(store, actor, request('2026-11-10', '2026-11-20'))
    const balance = store.data.leavebalances[0]
    expect(balance).toMatchObject({ pending: 5, usedDays: 0 })
  })

  test('rejects when the paid part exceeds the available balance', async () => {
    const store = createStore({
      leavebalances: [{ _id: '444444444444444444444444', employee: employeeId, leaveType: leaveTypeId, year: 2026, overrideDays: 3, totalDays: 3, source: 'manual' }],
    })
    await expect(submitLeaveRequest(store, actor, request('2026-11-10', '2026-11-20')))
      .rejects.toThrow('Insufficient Casual Leave balance')
    expect(store.data.leaves).toHaveLength(0)
  })

  test('rejects use of a type that is still locked by the DOJ grace period', async () => {
    const store = createStore()
    await expect(submitLeaveRequest(store, actor, request('2026-06-01', '2026-06-02')))
      .rejects.toThrow('locked until 01 Jul 2026')
    expect(store.data.leaves).toHaveLength(0)
  })

  test('allows a request that ends on the last working day and marks it LWP', async () => {
    const store = createStore()
    const result = await submitLeaveRequest(store, actor, request('2026-12-14', '2026-12-15'))
    expect(result.split).toBeNull()
    expect(store.data.leaves).toHaveLength(1)
    expect(store.data.leaves[0]).toMatchObject({ isLeaveWithoutPay: true, numberOfDays: 2 })
  })
})
