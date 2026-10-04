import { validateManpower, canRequestManpower, reviewManpower } from '@/lib/recruitment/manpower.server'
import { GET, POST } from '@/app/api/recruitment/requisitions/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { getManpowerStore } from '@/lib/recruitment/manpowerStore.server'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitRecruitmentUpdate: jest.fn() }))
jest.mock('@/lib/recruitment/manpowerStore.server', () => ({ ...jest.requireActual('@/lib/recruitment/manpowerStore.server'), getManpowerStore: jest.fn() }))
const hr = { _id: '111111111111111111111111', role: 'hr', employeeId: '222222222222222222222222' }
const manager = { _id: '333333333333333333333333', role: 'manager', employeeId: '444444444444444444444444' }
const input = () => ({ department: '555555555555555555555555', jobTitle: 'Engineer', jobDescription: 'Build and maintain our software products.', justification: 'New customer delivery team requires additional capacity.', location: 'Bhopal', numberOfPositions: 2, employmentType: 'full-time', workMode: 'hybrid', educationLevel: 'bachelor', experienceMin: 2, experienceMax: 5, salaryMin: 500000, salaryMax: 900000, currency: 'INR', requirements: ['Engineering experience'], responsibilities: ['Build applications'], skills: ['JavaScript'], benefits: [], submissionKey: 'test-request-key-1234', action: 'submit' })
let actor, record, store
beforeEach(() => {
  jest.clearAllMocks()
  actor = manager
  record = { _id: '666666666666666666666666', requestedBy: manager._id, employee: manager.employeeId, department: input().department, job: validateManpower(input()).job, status: 'pending', createdAt: new Date() }
  store = workflowStore({ users: [manager, hr], departments: [{ _id: input().department, name: 'Technology', isActive: true }], employees: [{ _id: manager.employeeId, status: 'active' }], manpowerrequests: [record] })
  getAuthAndDatabase.mockImplementation(async () => ({ success: true, user: { _id: actor._id }, tenant: { databaseName: 'talio_company_test' } }))
  getManpowerStore.mockResolvedValue(store)
})
const request = body => ({ url: 'https://test/api/recruitment/requisitions', json: async () => body })
test.each(['manager', 'team_leader', 'department_head', 'hr', 'admin'])('%s may request manpower', role => expect(canRequestManpower({ role })).toBe(true))
test('employee cannot request unless assigned leadership', () => {
  expect(canRequestManpower({ role: 'employee' })).toBe(false)
  expect(canRequestManpower({ role: 'employee', teamLeaderOf: ['team'] })).toBe(true)
})
test.each([{ numberOfPositions: 0 }, { numberOfPositions: 1.2 }, { numberOfPositions: '2' }, { salaryMin: -1 }, { salaryMax: 1 }, { experienceMax: 1 }, { department: { $ne: null } }, { requirements: [] }, { jobDescription: 'Short' }, { currency: '123' }])('validates invalid fields %j', bad => expect(() => validateManpower({ ...input(), ...bad })).toThrow())
test('only allowed public job fields survive input validation', () => {
  const result = validateManpower({ ...input(), status: 'open', createdBy: 'attacker', jobCode: 'bad' })
  expect(result.job.status).toBeUndefined()
  expect(result.job.justification).toBeUndefined()
  expect(result.job.salaryRange.isConfidential).toBe(true)
})
test('GET uses indexed requester scope and direct ID joins', async () => {
  expect((await GET(request())).status).toBe(200)
  expect(store.list).toHaveBeenCalledWith('manpowerrequests', expect.objectContaining({ filters: [{ field: 'requestedBy', operator: '==', value: manager._id }] }))
  actor = hr; await GET(request())
  expect(store.list).toHaveBeenCalledWith('manpowerrequests', expect.objectContaining({ filters: [] }))
})
test('server resolves department authority from indexed leadership relationships', async () => {
  await store.mutate('users', manager._id, user => ({ ...user, role: 'employee' }))
  await store.mutate('departments', input().department, department => ({ ...department, heads: [manager.employeeId] }))
  expect((await GET(request())).status).toBe(200)
})
test('unauthenticated, inactive and ordinary employees cannot access', async () => {
  getAuthAndDatabase.mockResolvedValueOnce({ success: false, status: 401 })
  expect((await GET(request())).status).toBe(401)
  await store.mutate('users', manager._id, user => ({ ...user, isActive: false }))
  expect((await POST(request(input()))).status).toBe(403)
  await store.mutate('users', manager._id, user => ({ ...user, isActive: true, role: 'employee' }))
  expect((await GET(request())).status).toBe(403)
})
test('submission binds authenticated identity and notifications atomically; retries do not duplicate', async () => {
  const first = await POST(request({ ...input(), requestedBy: 'attacker' }))
  expect(first.status).toBe(200)
  const created = await store.get('manpowerrequests', (await first.json()).data.id)
  expect(created).toMatchObject({ requestedBy: manager._id, employee: manager.employeeId })
  expect((await POST(request(input()))).status).toBe(200)
  expect(await store.count('manpowerrequests')).toBe(2)
  expect(await store.count('notifications')).toBe(1)
  expect(await store.count('jobpostings')).toBe(0)
})
test('HR approval atomically creates job and repeated approval never republishes', async () => {
  expect((await reviewManpower(store, hr, { id: record._id, action: 'approve' })).record.status).toBe('approved')
  expect(await store.get('jobpostings', record._id)).toMatchObject({ status: 'open', hiringManager: manager.employeeId, hiringPipeline: expect.arrayContaining([expect.objectContaining({ stageName: 'Applied' })]) })
  expect((await reviewManpower(store, hr, { id: record._id, action: 'approve' })).repeated).toBe(true)
  expect(await store.count('notifications')).toBe(1)
})
test('rejection requires reason and never publishes', async () => {
  await expect(reviewManpower(store, hr, { id: record._id, action: 'reject' })).rejects.toThrow('reason')
  expect((await reviewManpower(store, hr, { id: record._id, action: 'reject', reason: 'Budget not approved' })).record.status).toBe('rejected')
  expect(await store.count('jobpostings')).toBe(0)
})
test('managers, self reviewers, reviewed and unknown IDs are rejected', async () => {
  await expect(reviewManpower(store, manager, { id: record._id, action: 'approve' })).rejects.toMatchObject({ status: 403 })
  await expect(reviewManpower(store, { ...hr, _id: manager._id }, { id: record._id, action: 'approve' })).rejects.toMatchObject({ status: 403 })
  await store.mutate('manpowerrequests', record._id, current => ({ ...current, status: 'rejected' }))
  await expect(reviewManpower(store, hr, { id: record._id, action: 'approve' })).rejects.toMatchObject({ status: 409 })
  await expect(reviewManpower(store, hr, { id: '999999999999999999999999', action: 'approve' })).rejects.toMatchObject({ status: 404 })
})
test('notification persistence failure rolls back publication and approval', async () => {
  store.failCreate = 'notifications'
  await expect(reviewManpower(store, hr, { id: record._id, action: 'approve' })).rejects.toThrow('Simulated write failure')
  expect(await store.get('jobpostings', record._id)).toBeNull()
  expect((await store.get('manpowerrequests', record._id)).status).toBe('pending')
})
