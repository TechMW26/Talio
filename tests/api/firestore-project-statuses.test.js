jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/projectService', () => ({ checkProjectAccess: jest.fn(), createTimelineEvent: jest.fn(async () => {}) }))
jest.mock('@/lib/projects.server', () => ({ PROJECT_STORE_OPTIONS: {}, projectFilter: (field, value) => ({ field, value, operator: '==' }), projectRows: jest.fn(async () => []) }))
import { GET, PUT } from '@/app/api/projects/[projectId]/statuses/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { checkProjectAccess } from '@/lib/projectService'
import { projectRows } from '@/lib/projects.server'
import { DEFAULT_TASK_STATUSES } from '@/lib/taskStatusConfig'
const route = { params: Promise.resolve({ projectId: 'project' }) }
let database, project
beforeEach(() => {
  jest.clearAllMocks()
  project = { _id: 'project', taskStatuses: [...DEFAULT_TASK_STATUSES, { key: 'qa', label: 'QA' }] }
  database = { get: jest.fn(async collection => collection === 'users' ? { employeeId: 'employee', role: 'employee' } : project), mutate: jest.fn(async (collection, id, fn) => fn(project)) }
  getAuthAndDatabase.mockResolvedValue({ success: true, database, user: { _id: 'user' } })
  checkProjectAccess.mockResolvedValue({ hasAccess: true })
  projectRows.mockResolvedValue([])
})
test('reads status settings through the authorized Firestore tenant', async () => {
  const response = await GET(new Request('http://local/statuses'), route)
  expect(response.status).toBe(200)
  expect(checkProjectAccess).toHaveBeenCalledWith('project', 'employee', 'view', database)
})
test('denies unauthorized status edits', async () => {
  checkProjectAccess.mockResolvedValue({ hasAccess: false })
  expect((await PUT(new Request('http://local/statuses', { method: 'PUT', body: '{}' }), route)).status).toBe(403)
  expect(database.mutate).not.toHaveBeenCalled()
})
test('keeps statuses that are still referenced by tasks', async () => {
  projectRows.mockResolvedValue([{ status: 'qa' }])
  expect((await PUT(new Request('http://local/statuses', { method: 'PUT', body: JSON.stringify({ statuses: DEFAULT_TASK_STATUSES }) }), route)).status).toBe(400)
  expect(database.mutate).not.toHaveBeenCalled()
})
test('saves valid settings using Firestore mutation', async () => {
  expect((await PUT(new Request('http://local/statuses', { method: 'PUT', body: JSON.stringify({ statuses: DEFAULT_TASK_STATUSES }) }), route)).status).toBe(200)
  expect(database.mutate).toHaveBeenCalledWith('projects', 'project', expect.any(Function))
})
