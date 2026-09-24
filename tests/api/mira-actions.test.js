jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/permissions', () => ({ requirePermission: jest.fn() }))
jest.mock('@/app/api/tasks/create/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/projects/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/chat/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/chat/[chatId]/messages/route', () => ({ POST: jest.fn() }))
import { requirePermission } from '@/lib/permissions'
import { POST } from '@/app/api/ai/mira-actions/route'
import { prepareMiraAction, validateMiraAction } from '@/lib/miraActions'
import { sanitizeMiraCards } from '@/lib/miraStructuredCards'
import { miraNavigationPath } from '@/lib/miraNavigation'
import { POST as createTask } from '@/app/api/tasks/create/route'
import { POST as createProject } from '@/app/api/projects/route'
import { POST as createChat } from '@/app/api/chat/route'
import { POST as sendChatMessage } from '@/app/api/chat/[chatId]/messages/route'

const action = { type: 'create_task', fields: { title: 'Review draft', assignees: ['me'] } }
const run = body => POST(new Request('https://talio.test/api/ai/mira-actions', { method: 'POST', body: JSON.stringify(body) }))
beforeEach(() => jest.clearAllMocks())
test('project creation preserves the new record identity for opening and follow-ups', async () => {
  requirePermission.mockReturnValue(async () => ({ user: { employeeId: 'own', role: 'admin' }, models: {} }))
  const id = '507f1f77bcf86cd799439011'
  createProject.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { _id: id } })))
  const result = await (await run({ confirmed: true, action: { type: 'create_project', fields: { name: 'Test', startDate: '2026-09-24', endDate: '2026-10-01', heads: ['me'] } } })).json()
  expect(result.resource).toEqual({ page: 'projects', id })
})
test('rejects incomplete actions, unknown operations and invalid meeting dates', () => {
  expect(validateMiraAction({ type: 'create_task', fields: { title: 'Draft' } }).error).toContain('assignees')
  expect(validateMiraAction({ type: 'delete_database', fields: {} }).error).toBeTruthy()
  expect(validateMiraAction({ type: 'create_meeting', fields: { title: 'Review', agenda: 'Plan', invitees: ['me'], type: 'online', scheduledStart: '2026-01-01T10:00:00Z', scheduledEnd: '2026-01-01T09:00:00Z' } }).error).toBeTruthy()
})
test('never forwards generated operators or arbitrary fields to existing APIs', async () => {
  const result = await prepareMiraAction({ ...action, fields: { ...action.fields, role: 'admin', url: 'https://attacker.test', $where: 'bad' } }, { employeeId: 'own' }, {})
  expect(result.path).toBe('/api/tasks/create')
  expect(result.body.assigneeIds).toEqual(['own'])
  expect(result.body).not.toHaveProperty('role')
  expect(result.body).not.toHaveProperty('$where')
})
test('denied permissions block preparation and execution', async () => {
  requirePermission.mockReturnValue(async () => ({ denied: new Response('', { status: 403 }) }))
  const result = await run({ action, confirmed: true })
  expect(result.status).toBe(403)
  expect((await result.json()).message).toContain('access level')
})
test('unconfirmed actions only return a preview', async () => {
  requirePermission.mockReturnValue(async () => ({ user: { employeeId: 'own' }, models: {} }))
  const response = await run({ action })
  expect((await response.json()).preview).toEqual(action)
  expect(requirePermission).toHaveBeenCalledWith('tasks', 'create')
  expect(createTask).not.toHaveBeenCalled()
})
test('confirmed writes delegate to the existing authenticated API and report success only after it succeeds', async () => {
  requirePermission.mockReturnValue(async () => ({ user: { employeeId: 'own' }, models: {} }))
  createTask.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, message: 'Task created' })))
  const result = await (await run({ action, confirmed: true })).json()
  expect(result).toMatchObject({ success: true, page: 'tasks', message: 'Task created' })
  expect(await createTask.mock.calls[0][0].json()).toMatchObject({ title: 'Review draft', assigneeIds: ['own'] })
  createTask.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'Denied' }), { status: 403 }))
  expect((await run({ action, confirmed: true })).status).toBe(403)
})
test('employee names are resolved within tenant and reporting scope; ambiguity fails closed', async () => {
  const lean = jest.fn().mockResolvedValue([{ _id: 'a' }, { _id: 'b' }])
  const find = jest.fn(() => ({ select: () => ({ populate: () => ({ limit: () => ({ lean }) }) }) }))
  await expect(prepareMiraAction({ ...action, fields: { ...action.fields, assignees: ['Same Name'] } }, { employeeId: 'own', role: 'employee' }, { Employee: { find } })).rejects.toThrow('Choose the person')
  expect(JSON.stringify(find.mock.calls[0][0])).toContain('reportingManager')
  expect(JSON.stringify(find.mock.calls[0][0])).toContain('own')
})
test('navigation and generated JSON are bounded and cannot inject links', () => {
  expect(miraNavigationPath('tasks')).toBe('/dashboard/projects/my-tasks')
  expect(miraNavigationPath('https://attacker.test')).toBeNull()
  expect(miraNavigationPath('__proto__')).toBeNull()
  expect(sanitizeMiraCards([{ type: 'list', data: { items: [{ title: 'Hello', link: 'javascript:alert(1)' }] } }])[0].data.items[0]).not.toHaveProperty('link')
  expect(sanitizeMiraCards([{ type: 'info', data: { text: 'filler' } }])).toEqual([])
})

test('creates a missing direct conversation then sends through the authenticated message route', async () => {
  const person = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', firstName: 'Sahil', lastName: 'Sahu', employeeCode: 'U22' }
  const query = { select: jest.fn().mockReturnThis(), populate: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([person]) }
  requirePermission.mockReturnValue(async () => ({ user: { employeeId: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'employee' }, models: {
    Employee: { find: () => query }, Chat: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
  } }))
  createChat.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { _id: 'cccccccccccccccccccccccc' } })))
  sendChatMessage.mockResolvedValue(new Response(JSON.stringify({ success: true, message: 'Message sent' })))
  const result = await (await run({ action: { type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } }, confirmed: true })).json()
  expect(result.success).toBe(true)
  expect(await createChat.mock.calls[0][0].json()).toEqual({ isGroup: false, participants: [person._id] })
  expect(await sendChatMessage.mock.calls[0][0].json()).toEqual({ content: 'Hello' })
  expect(await sendChatMessage.mock.calls[0][1].params).toEqual({ chatId: 'cccccccccccccccccccccccc' })
})

test('ambiguous people return choices before any side effect', async () => {
  const query = { select: jest.fn().mockReturnThis(), populate: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([
    { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', firstName: 'Sahil', lastName: 'Sahu' },
    { _id: 'cccccccccccccccccccccccc', firstName: 'Sahil', lastName: 'Sharma' },
  ]) }
  requirePermission.mockReturnValue(async () => ({ user: { employeeId: 'own', role: 'admin' }, models: { Employee: { find: () => query } } }))
  const response = await run({ action: { type: 'send_message', fields: { recipient: 'Sahil', content: 'Hello' } }, confirmed: true })
  expect(response.status).toBe(409)
  expect((await response.json()).resolution.candidates).toHaveLength(2)
  expect(createChat).not.toHaveBeenCalled()
  expect(sendChatMessage).not.toHaveBeenCalled()
})
