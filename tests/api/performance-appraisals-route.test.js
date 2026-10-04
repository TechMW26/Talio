jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) }, after: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
import { after } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { POST } from '@/app/api/performance/appraisals/route'
import { POST as postAction } from '@/app/api/performance/appraisals/[id]/actions/route'
const ids = Object.fromEntries(['requester', 'requesterEmployee', 'employee', 'managerEmployee', 'headEmployee', 'department', 'managerUser', 'headUser', 'hrUser', 'adminUser', 'appraisal'].map((name, index) => [name, (index + 1).toString(16).padStart(24, '0')]))
const input = { employeeId: ids.employee, reviewPeriod: 'FY 2026-27', proposedIncreasePercent: 8, reason: 'Consistent delivery and expanded ownership', pointers: ['Delivered release ahead of schedule'] }
function setup({ hrIsEarlierApprover = false, actorRole = 'team_leader', actorEmployeeId = ids.requesterEmployee, appraisal } = {}) {
  const actor = { _id: ids.requester, role: actorRole, employeeId: actorEmployeeId, isActive: true }
  const users = [actor, { _id: ids.managerUser, employeeId: ids.managerEmployee, isActive: true, role: hrIsEarlierApprover ? 'hr' : 'manager' }, { _id: ids.headUser, employeeId: ids.headEmployee, role: 'department_head', isActive: true }, { _id: ids.adminUser, role: 'admin', isActive: true }]
  if (!hrIsEarlierApprover) users.push({ _id: ids.hrUser, role: 'hr', isActive: true })
  const database = workflowStore({ users, employees: [{ _id: ids.employee, firstName: 'Alex', lastName: 'Employee', department: ids.department, assignedTeamLead: ids.requesterEmployee, assignedManager: ids.managerEmployee }], departments: [{ _id: ids.department, head: ids.headEmployee, isActive: true }], performanceappraisals: appraisal ? [appraisal] : [] })
  getFirestoreTenantDatabase.mockResolvedValue(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, user: actor, tenant: { databaseName: 'talio_company_test' } })
  return database
}
const createRequest = body => new Request('https://talio.test/api/performance/appraisals', { method: 'POST', body: JSON.stringify(body) })
async function notifications() { for (const [callback] of after.mock.calls) await callback() }
beforeEach(() => jest.clearAllMocks())
test('routes manager, department head and independent HR with durable notification', async () => {
  const database = setup(), response = await POST(createRequest(input)), result = await response.json()
  expect(response.status).toBe(201)
  expect(result.data.approvalSteps.map(step => step.role)).toEqual(['manager', 'department_head', 'hr'])
  expect(result.data.approvalSteps[2].approverUsers.map(row => row._id)).toEqual([ids.hrUser])
  const stored = (await database.list('performanceappraisals')).records[0]
  expect(stored.timeline[0].type).toBe('submitted')
  await notifications(); await notifications()
  expect((await database.list('notifications')).records).toHaveLength(1)
})
test('same hierarchy approver is excluded from HR discussion; independent admin fallback', async () => {
  const database = setup({ hrIsEarlierApprover: true })
  expect((await POST(createRequest(input))).status).toBe(201)
  const saved = (await database.list('performanceappraisals')).records[0]
  expect(saved.approvalSteps[0].approverUser).toBe(ids.managerUser)
  expect(saved.approvalSteps.at(-1).approverUsers).toEqual([ids.adminUser])
})
test('malformed employee or appraisal IDs yield 400', async () => {
  setup()
  expect((await POST(createRequest({ ...input, employeeId: 'bad' }))).status).toBe(400)
  expect((await postAction(createRequest({}), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400)
})
test('manager outside reporting scope cannot create', async () => {
  const database = setup({ actorRole: 'manager', actorEmployeeId: ids.adminUser })
  expect((await POST(createRequest(input))).status).toBe(403)
  expect((await database.list('performanceappraisals')).records).toHaveLength(0)
})
function pending() { return { _id: ids.appraisal, employee: ids.employee, reviewPeriod: input.reviewPeriod, proposedIncreasePercent: 8, requestedByUser: ids.requester, currentStepIndex: 0, workflowVersion: 4, status: 'pending_approval', approvalSteps: [{ role: 'manager', approverUser: ids.managerUser, status: 'pending' }, { role: 'department_head', approverUser: ids.headUser, status: 'pending' }, { role: 'hr', approverUsers: [ids.hrUser], status: 'pending' }], timeline: [] } }
function act(user, body) { getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: user }, tenant: { databaseName: 'talio_company_test' } }); return postAction(createRequest(body), { params: Promise.resolve({ id: ids.appraisal }) }) }
test('assigned reviewer advances one step atomically and notifies next reviewer', async () => {
  const database = setup({ appraisal: pending() })
  const response = await act(ids.managerUser, { action: 'approve', comment: 'Reviewed goals', workflowVersion: 4 })
  expect(response.status).toBe(200); expect((await response.json()).data.currentStepIndex).toBe(1)
  expect((await database.get('performanceappraisals', ids.appraisal)).workflowVersion).toBe(5)
  await notifications()
  expect((await database.list('notifications')).records[0].user).toBe(ids.headUser)
})
test('stale approval version yields conflict without notification', async () => {
  setup({ appraisal: pending() })
  expect((await act(ids.managerUser, { action: 'approve', workflowVersion: 3 })).status).toBe(409)
  expect(after).not.toHaveBeenCalled()
})
test('HR discussion requires outcome and notes, then notifies requester', async () => {
  const appraisal = pending(); appraisal.currentStepIndex = 2; appraisal.status = 'hr_discussion'
  const database = setup({ appraisal })
  expect((await act(ids.hrUser, { action: 'approve' })).status).toBe(400)
  const response = await act(ids.hrUser, { action: 'complete_discussion', outcome: 'approved', comment: 'Discussed the recommendation and agreed rationale' })
  expect(response.status).toBe(200)
  expect((await response.json()).data.hrDiscussion).toMatchObject({ outcome: 'approved', completedBy: ids.hrUser })
  await notifications()
  expect((await database.list('notifications')).records[0].user).toBe(ids.requester)
})
