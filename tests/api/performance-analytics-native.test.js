jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { GET as calculate } from '@/app/api/performance/calculate/route'
import { GET as taskStats } from '@/app/api/performance/task-stats/route'
import { GET as attendanceStats } from '@/app/api/performance/attendance-stats/route'
const employee = '111111111111111111111111', user = '222222222222222222222222', task = '333333333333333333333333'
beforeEach(() => {
  const database = workflowStore({ users: [{ _id: user, employeeId: employee, role: 'admin', isActive: true }], employees: [{ _id: employee, status: 'active', firstName: 'Test', lastName: 'Employee', reviews: [], dateOfJoining: new Date('2026-01-01') }], taskassignees: [{ _id: 'assignment', user: employee, task, assignmentStatus: 'accepted', assignedAt: new Date('2026-10-01') }], tasks: [{ _id: task, status: 'completed', createdAt: new Date('2026-10-01'), dueDate: new Date('2026-10-03'), completedAt: new Date('2026-10-02') }], attendances: [{ _id: 'attendance', employee, date: new Date('2026-10-01'), status: 'present', workHours: 8 }], companies: [], companysettings: [] })
  getFirestoreTenantDatabase.mockResolvedValue(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: user, role: 'admin' }, tenant: { databaseName: 'talio_company_test' } })
})
const request = () => new Request('https://talio.test/api/performance?startDate=2026-10-01&endDate=2026-10-03')
test('native performance calculation retains metrics and finite summary totals', async () => {
  const response = await calculate(request()), body = await response.json()
  expect(response.status).toBe(200); expect(body.data[0].metrics.tasks.completed).toBe(1)
  expect(Number.isFinite(body.summary.goalCompletionRate)).toBe(true)
  expect(Number.isFinite(body.summary.projectCompletionRate)).toBe(true)
})
test('native task statistics read only assigned task IDs', async () => {
  const response = await taskStats(request()), body = await response.json()
  expect(response.status).toBe(200); expect(body.data.summary.completedTasks).toBe(1)
})
test('native attendance statistics retain totals', async () => {
  const response = await attendanceStats(request()), body = await response.json()
  expect(response.status).toBe(200); expect(body.data.summary.presentDays).toBe(1)
})
