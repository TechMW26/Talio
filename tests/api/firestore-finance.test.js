import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { FINANCE_STORE_OPTIONS, savePayroll, bulkPayroll, listPayroll, readPayroll, saveExpense, deleteExpense, listExpenses } from '@/lib/finance.server'
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(45000)
suite('native finance permissions and transactions', () => {
  let firestore, database
  const person = '111111111111111111111111', manager = '222222222222222222222222', other = '333333333333333333333333'
  const owner = { _id: '444444444444444444444444', employeeId: person, role: 'employee', isActive: true }
  const boss = { _id: '555555555555555555555555', employeeId: manager, role: 'manager', isActive: true }
  const hr = { _id: '666666666666666666666666', employeeId: manager, role: 'hr', isActive: true }
  const admin = { _id: '777777777777777777777777', employeeId: other, role: 'admin', isActive: true }
  const payroll = { employee: person, month: 10, year: 2026, basic: 10000, allowances: 1000, deductions: 100, netSalary: 10900 }
  const expense = { category: 'travel', amount: 250, description: 'Client visit', expenseDate: '2026-10-01' }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => firestore?.terminate())
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-finance-${Date.now()}-${randomBytes(4).toString('hex')}`, databaseName: 'talio_company_test', ...FINANCE_STORE_OPTIONS })
    for (const actor of [owner, boss, hr, admin]) await database.create('users', actor)
    for (const id of [person, manager, other]) await database.create('employees', { _id: id, firstName: 'Test', employeeCode: id === person ? 'U50' : id, assignedManager: id === person ? manager : null })
  })
  test('concurrent payroll generation creates exactly one record for employee and month', async () => {
    const results = await Promise.allSettled([savePayroll(database, hr, payroll), savePayroll(database, hr, payroll)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(await database.count('payrolls')).toBe(1)
  })
  test('employee cannot generate payroll or read another employee, employee code is supported', async () => {
    await expect(savePayroll(database, owner, payroll)).rejects.toMatchObject({ status: 403 })
    const record = await savePayroll(database, hr, payroll)
    expect((await listPayroll(database, owner, new URLSearchParams('employeeId=U50')))[0]._id).toBe(record._id)
    const outsider = { ...owner, _id: '888888888888888888888888', employeeId: other }
    await database.create('users', outsider)
    await expect(readPayroll(database, outsider, record._id)).rejects.toMatchObject({ status: 403 })
    expect(await listPayroll(database, outsider, new URLSearchParams())).toEqual([])
  })
  test('bulk payroll payment is atomic and paid records cannot reopen or delete', async () => {
    const first = await savePayroll(database, hr, payroll)
    const second = await savePayroll(database, hr, { ...payroll, month: 11 })
    await bulkPayroll(database, hr, [first._id], 'process')
    await expect(bulkPayroll(database, hr, [first._id, second._id], 'pay')).rejects.toMatchObject({ status: 409 })
    expect((await database.get('payrolls', first._id)).status).toBe('processed')
    await bulkPayroll(database, hr, [first._id], 'pay')
    await expect(bulkPayroll(database, hr, [first._id], 'delete')).rejects.toMatchObject({ status: 409 })
    await expect(savePayroll(database, hr, { status: 'draft' }, first._id)).rejects.toMatchObject({ status: 409 })
  })
  test('existing calculator rounding and zero net salary are preserved', async () => {
    const row = await savePayroll(database, hr, { ...payroll, grossSalary: 100.01, earningsBreakdown: { basic: 51, hra: 51 }, deductions: 150, netSalary: 0 })
    expect(row.grossSalary).toBe(100.01); expect(row.netSalary).toBe(0)
    await expect(savePayroll(database, hr, { ...payroll, month: 11, netSalary: 99999 })).rejects.toThrow('Net salary')
  })
  test('expense ownership, reporting scope and self-approval are enforced', async () => {
    const row = await saveExpense(database, owner, expense)
    expect((await listExpenses(database, boss, new URLSearchParams('status=submitted')))[0]._id).toBe(row._id)
    expect(await listExpenses(database, hr, new URLSearchParams('status=pending'))).toEqual([])
    await expect(saveExpense(database, owner, { status: 'approved' }, row._id)).rejects.toMatchObject({ status: 403 })
    await expect(saveExpense(database, hr, { amount: 100 }, row._id)).rejects.toMatchObject({ status: 403 })
    await saveExpense(database, boss, { status: 'approved' }, row._id)
    await expect(saveExpense(database, owner, { amount: 1 }, row._id)).rejects.toMatchObject({ status: 403 })
    await expect(deleteExpense(database, admin, row._id)).rejects.toMatchObject({ status: 409 })
    await saveExpense(database, admin, { status: 'reimbursed', transactionId: 'test-only' }, row._id)
    expect((await database.get('expenses', row._id)).status).toBe('reimbursed')
  })
  test('competing expense decisions cannot overwrite one another', async () => {
    const row = await saveExpense(database, owner, expense)
    const result = await Promise.allSettled([saveExpense(database, boss, { status: 'approved' }, row._id), saveExpense(database, admin, { status: 'rejected' }, row._id)])
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  })
  test('pending approval lists split large reporting scopes within disjunction limits', async () => {
    for (let i = 0; i < 17; i++) {
      const employee = randomBytes(12).toString('hex')
      await database.create('employees', { _id: employee, firstName: 'Report', assignedManager: manager })
      await database.create('expenses', { _id: randomBytes(12).toString('hex'), employee, status: i % 2 ? 'pending' : 'submitted', amount: 10, createdAt: new Date() })
    }
    expect(await listExpenses(database, boss, new URLSearchParams('status=pending'))).toHaveLength(17)
  })
})
