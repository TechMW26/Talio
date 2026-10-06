import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { PERFORMANCE_OPTIONS, performanceEmployees, savePerformanceGoal, deletePerformanceGoal, savePerformanceReview, scopedPerformanceRecords } from '@/lib/performanceStore.server'
import { createAppraisal, actOnAppraisal, listAppraisals } from '@/lib/hrms/performanceAppraisalStore.server'
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(45000)
suite('native performance workflows', () => {
  let firestore, database
  const employee = '111111111111111111111111', manager = '222222222222222222222222', outside = '333333333333333333333333'
  const user = { _id: '444444444444444444444444', employeeId: employee, role: 'employee', isActive: true }
  const lead = { _id: '555555555555555555555555', employeeId: manager, role: 'manager', isActive: true }
  const hr = { _id: '666666666666666666666666', employeeId: outside, role: 'hr', isActive: true }
  const admin = { _id: '777777777777777777777777', employeeId: manager, role: 'admin', isActive: true }
  beforeAll(() => { if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required'); firestore = new Firestore({ projectId: 'demo-talio-firestore' }) })
  afterAll(async () => firestore?.terminate())
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-performance-${Date.now()}-${randomBytes(4).toString('hex')}`, databaseName: 'talio_company_test', ...PERFORMANCE_OPTIONS })
    for (const actor of [user, lead, hr, admin]) await database.create('users', actor)
    for (const id of [employee, manager, outside]) await database.create('employees', { _id: id, status: 'active', assignedManager: id === employee ? manager : null, firstName: 'Test', reviews: [] })
  })
  test('employee filter cannot override caller reporting scope', async () => {
    await expect(performanceEmployees(database, user, new URLSearchParams({ employeeId: outside }))).rejects.toMatchObject({ status: 403 })
    expect((await performanceEmployees(database, lead)).map(row => row._id).sort()).toEqual([employee, manager])
    expect(await performanceEmployees(database, user, new URLSearchParams({ team: '888888888888888888888888' }))).toEqual([])
  })
  test('manager goals enforce scope, employee can update progress but cannot reassign or rewrite title', async () => {
    const goal = await savePerformanceGoal(database, lead, { employeeId: employee, title: 'Learn', dueDate: '2026-12-01', milestones: [{ title: 'Read', completed: false }] })
    await expect(savePerformanceGoal(database, lead, { employeeId: outside, title: 'No', dueDate: '2026-12-01' })).rejects.toMatchObject({ status: 403 })
    const updated = await savePerformanceGoal(database, user, { progress: 100, title: 'Forged', employeeId: outside }, goal._id)
    expect(updated.employee).toBe(employee); expect(updated.title).toBe('Learn'); expect(updated.status).toBe('completed')
    await expect(deletePerformanceGoal(database, user, goal._id)).rejects.toMatchObject({ status: 403 })
  })
  test('review creation validates rating and persists only permitted target', async () => {
    await expect(savePerformanceReview(database, user, { employee, ratings: { work: 5 } })).rejects.toMatchObject({ status: 403 })
    await expect(savePerformanceReview(database, lead, { employee, ratings: { work: 6 } })).rejects.toMatchObject({ status: 400 })
    const record = await savePerformanceReview(database, lead, { employee, ratings: [{ rating: 5 }, { rating: 3 }] })
    expect(record.overallRating).toBe(4)
    expect(await scopedPerformanceRecords(database, 'performances', [{ _id: outside }])).toEqual([])
  })
  test('duplicate appraisal submission is serialized, HR decision records version and timeline', async () => {
    const input = { employeeId: employee, reviewPeriod: '2026-Q4', proposedIncreasePercent: 10, reason: 'Consistent measurable improvement', pointers: ['Delivered milestones'] }
    const outcomes = await Promise.allSettled([createAppraisal(database, admin, input), createAppraisal(database, admin, input)])
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const record = outcomes.find(row => row.status === 'fulfilled').value
    expect(record.status).toBe('hr_discussion')
    expect((await listAppraisals(database, user, new URLSearchParams())).data).toEqual([])
    await expect(actOnAppraisal(database, admin, record._id, { action: 'complete_discussion', outcome: 'approved', comment: 'Agreed after review' })).rejects.toMatchObject({ status: 403 })
    const approved = await actOnAppraisal(database, hr, record._id, { action: 'complete_discussion', outcome: 'approved', comment: 'Agreed after review' })
    expect(approved.workflowVersion).toBe(2); expect(approved.timeline).toHaveLength(2)
    expect((await listAppraisals(database, user, new URLSearchParams())).data[0]._id).toBe(record._id)
    await expect(actOnAppraisal(database, hr, record._id, { action: 'complete_discussion', outcome: 'rejected', comment: 'Late duplicate' })).rejects.toMatchObject({ status: 403 })
  })
  test('employee review ID projection stays in sync with mutations', async () => {
    await database.mutate('employees', employee, row => ({ ...row, reviews: [{ _id: outside, rating: 4 }] }))
    expect((await database.list('employees', { filters: [{ field: 'reviewIds', operator: 'array-contains', value: outside }], limit: 2 })).records.map(row => row._id)).toEqual([employee])
  })
  test('large reporting scopes batch date-filtered records without losing any employee', async () => {
    const ids = Array.from({ length: 31 }, (_, index) => (1000 + index).toString(16).padStart(24, '0'))
    await Promise.all(ids.map(id => database.create('dailygoals', { _id: id, employee: id, date: new Date('2026-10-01') })))
    const rows = await scopedPerformanceRecords(database, 'dailygoals', ids, [{ field: 'date', operator: '>=', value: new Date('2026-09-01') }, { field: 'date', operator: '<=', value: new Date('2026-11-01') }])
    expect(rows.map(row => row.employee).sort()).toEqual(ids.sort())
  })
})
