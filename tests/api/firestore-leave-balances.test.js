import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '../../lib/platform/firestoreStore.server'
import { LEAVE_BALANCE_STORE_OPTIONS, ensureEmployeeLeaveBalances } from '../../lib/leaveAllocation.server'
import { adjustLeaveBalance, listLeaveBalances } from '../../lib/leaveBalances.server'

jest.setTimeout(45000)
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
const employee = '111111111111111111111111', leaveType = 'aaaaaaaaaaaaaaaaaaaaaaaa', other = '222222222222222222222222'
emulator('native leave allocation and adjustments', () => {
  let firestore, database
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    database = createFirestoreDatabase({ firestore, dataset: `test-leave-${Date.now()}`, databaseName: 'talio_company_leave', ...LEAVE_BALANCE_STORE_OPTIONS })
    await database.create('employees', { _id: employee, firstName: 'Active', status: 'probation', dateOfJoining: new Date('2026-07-01') })
    await database.create('employees', { _id: other, firstName: 'Departed', status: 'terminated' })
    await database.create('leavetypes', { _id: leaveType, isActive: true, name: 'Annual', maxDaysPerYear: 12 })
  })
  afterAll(async () => firestore?.terminate())
  test('concurrent allocation creates one prorated entitlement', async () => {
    const results = await Promise.all([ensureEmployeeLeaveBalances({ database, employeeId: employee, year: 2026 }), ensureEmployeeLeaveBalances({ database, employeeId: employee, year: 2026 })])
    expect(results.reduce((sum, result) => sum + result.allocated, 0)).toBe(1)
    expect(await database.count('leavebalances')).toBe(1)
    const balances = await listLeaveBalances(database, { role: 'employee', employeeId: employee }, { year: 2026 })
    expect(balances[0].totalDays).toBe(6.05)
    expect(balances[0].employee._id).toBe(employee)
  })
  test('HR adjustments and pending/used leave survive allocation retries', async () => {
    const current = (await database.list('leavebalances')).records[0]
    await database.mutate('leavebalances', current._id, balance => ({ ...balance, usedDays: 2, pending: 1, carriedForward: 3 }))
    const result = await adjustLeaveBalance(database, { role: 'hr' }, { employee, leaveType, year: 2026, totalDays: 20 })
    expect(result.created).toBe(false)
    expect(result.data).toMatchObject({ totalDays: 20, usedDays: 2, pending: 1, carriedForward: 3, remainingDays: 20 })
    await ensureEmployeeLeaveBalances({ database, employeeId: employee, year: 2026 })
    expect((await database.get('leavebalances', current._id)).totalDays).toBe(20)
  })
  test('enforces self scope, management rights, references and year validation', async () => {
    await expect(listLeaveBalances(database, { role: 'employee', employeeId: employee }, { employeeId: other, year: 2026 })).rejects.toMatchObject({ status: 403 })
    await expect(adjustLeaveBalance(database, { role: 'employee' }, { employee, leaveType, year: 2026, totalDays: 10 })).rejects.toMatchObject({ status: 403 })
    await expect(adjustLeaveBalance(database, { role: 'hr' }, { employee, leaveType: 'bbbbbbbbbbbbbbbbbbbbbbbb', year: 2026, totalDays: 10 })).rejects.toMatchObject({ status: 404 })
    await expect(listLeaveBalances(database, { role: 'hr' }, { year: 2026.5 })).rejects.toMatchObject({ status: 400 })
    expect(await ensureEmployeeLeaveBalances({ database, employeeId: other, year: 2026 })).toMatchObject({ allocated: 0 })
    expect(await listLeaveBalances(database, { role: 'hr' }, { year: 2026 })).toHaveLength(1)
  })
  test('imported IDs are retained rather than duplicated', async () => {
    await database.create('leavebalances', { _id: 'cccccccccccccccccccccccc', employee, leaveType, year: 2025, allocated: 9, used: 2, pending: 1 })
    await ensureEmployeeLeaveBalances({ database, employeeId: employee, year: 2025 })
    const result = await adjustLeaveBalance(database, { role: 'hr' }, { employee, leaveType, year: 2025, totalDays: 15 })
    expect(result.data).toMatchObject({ _id: 'cccccccccccccccccccccccc', usedDays: 2, pending: 1, remainingDays: 12 })
  })
  test('HR listing preserves balances across membership component-boundary batches', async () => {
    const ids = Array.from({ length: 27 }, (_, index) => (1000 + index).toString(16).padStart(24, '0'))
    await Promise.all(ids.map(async id => {
      await database.create('employees', { _id: id, status: 'active' })
      await database.create('leavebalances', { _id: id, employee: id, leaveType, year: 2027, totalDays: 12 })
    }))
    const result = await listLeaveBalances(database, { role: 'hr' }, { year: 2027 })
    expect(result.map(row => row.employee._id).sort()).toEqual(ids.sort())
  })
})
