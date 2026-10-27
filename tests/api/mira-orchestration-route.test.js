jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))
jest.mock('@/lib/ai/aiProviderManager', () => ({ streamContent: jest.fn() }))
jest.mock('@/lib/miraRetrieval.server', () => ({ planMiraRetrieval: jest.fn(async () => ({ kind: 'none' })), MIRA_RETRIEVAL_POLICY: '' }))
import { getAuthAndDatabase } from '@/lib/auth'
import { generateContent } from '@/lib/gemini'
import { planMiraRetrieval } from '@/lib/miraRetrieval.server'
import { POST } from '@/app/api/ai/mira-chat/route'
import { recordMiraTaskOutcome } from '@/lib/miraTaskBank'

let database
beforeEach(() => {
  jest.clearAllMocks()
  const user = { _id: 'A', employeeId: 'emp-A', role: 'employee', isActive: true }
  database = { get: jest.fn(async c => c === 'users' ? user : null), create: jest.fn(), replace: jest.fn(), list: jest.fn(async () => ({ records: [] })) }
  database.transaction = async fn => fn(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, user, database, tenant: { databaseName: 'test-orchestration' } })
})
const run = async (message, generated, taskBank, conversationHistory = []) => {
  generateContent.mockResolvedValue(JSON.stringify(generated))
  const response = await POST(new Request('https://app.talio.in/api/ai/mira-chat', { method: 'POST', body: JSON.stringify({ message, taskBank, conversationHistory, clientContext: { desktopComputerAvailable: true } }) }))
  expect(response.status).toBe(200)
  return (await response.json()).response
}

test('public research is a real prerequisite and verified evidence reaches the dependent decision', async () => {
  const tasks = [
    { id: 'research', request: 'Search the internet for NASA Artemis updates', dependsOn: [], action: { type: 'search_internet', fields: { query: 'NASA Artemis updates' } } },
    { id: 'notes', request: 'Create a task with the verified Artemis update', dependsOn: ['research'], action: { type: 'create_task', fields: {} } },
  ]
  const first = await run('Search the internet for NASA Artemis updates and create a task with the verified update', { message: '', taskId: 'research', taskPlan: tasks, action: tasks[0].action })
  expect(first.action).toEqual(tasks[0].action)
  expect(first.taskBank.tasks.map(task => task.id)).toEqual(['research', 'notes'])
  expect(first.taskBank.tasks[1].dependsOn).toEqual(['research'])
  expect(planMiraRetrieval).not.toHaveBeenCalled()
  const evidence = 'NASA official update: Artemis systems test completed. Source: https://www.nasa.gov/artemis/'
  const completed = recordMiraTaskOutcome(first.taskBank, { success: true, message: evidence })
  const second = await run(tasks[1].request, { message: '', taskId: 'notes', action: { type: 'create_task', fields: { title: 'Review Artemis systems test', description: evidence } } }, completed,
    [{ role: 'user', content: 'Research Artemis and create a task' }, { role: 'assistant', content: evidence }])
  expect(second.action.type).toBe('create_task')
  expect(second.taskBank.tasks[0].status).toBe('completed')
  expect(second.taskBank.tasks[1].id).toBe('notes')
  const system = generateContent.mock.calls.at(-1)[1]
  expect(system).toContain('https://www.nasa.gov/artemis/')
  expect(system).toContain('"activeTaskId":"notes"')
  expect(database.list.mock.calls.every(([collection]) => collection === 'miratokenusages')).toBe(true)
})

test('a desktop step receives only its assigned goal, not the whole mixed request', async () => {
  const response = await run('Open Calculator and remind me to review the answer in 20 minutes', {
    message: '', taskId: 'calc', action: { type: 'desktop_task' }, taskPlan: [
      { id: 'calc', request: 'Open Calculator', dependsOn: [], action: { type: 'desktop_task' } },
      { id: 'remind', request: 'Remind me to review the answer in 20 minutes', dependsOn: ['calc'], action: { type: 'schedule_reminder', fields: {} } },
    ],
  })
  expect(response.action).toEqual({ type: 'desktop_task', goal: 'Open Calculator' })
  expect(response.taskBank.tasks).toHaveLength(2)
})

test.each([
  [{ id: 'one', dependsOn: ['missing'] }],
  [{ id: 'one', dependsOn: [42] }],
].map(tasks => [tasks]))('malformed model dependencies cannot emit an executable action', async tasks => {
  const response = await run('Create a task and remind me about it', { message: '', action: { type: 'create_task', fields: { title: 'Unsafe plan' } }, taskPlan: tasks.map(task => ({ ...task, request: 'Create task', action: { type: 'create_task', fields: { title: 'Unsafe plan' } } })) })
  expect(response.action).toBeUndefined()
  expect(response.taskBank.tasks.every(task => task.status === 'blocked')).toBe(true)
  expect(response.message).toContain('nothing from this step was executed')
})

test('a dependent cannot execute when every prerequisite is blocked', async () => {
  const bank = { tasks: [
    { id: 'create', request: 'Create notes', dependsOn: ['lookup'], action: { type: 'create_task', fields: { title: 'Notes' } }, status: 'pending' },
    { id: 'lookup', request: 'Find the source', dependsOn: [], action: { type: 'search_internet', fields: { query: 'NASA Artemis' } }, status: 'blocked' },
  ] }
  const response = await run('Continue', { message: '', taskId: 'create', action: bank.tasks[0].action }, bank)
  expect(response.action).toBeUndefined()
})

test('same-type task decisions cannot silently overwrite another node or use its ID', async () => {
  const bank = { tasks: [
    { id: 'a', request: 'Create task A', dependsOn: [], action: { type: 'create_task', fields: { title: 'Task A' } }, status: 'pending' },
    { id: 'b', request: 'Create task B', dependsOn: ['a'], action: { type: 'create_task', fields: { title: 'Task B' } }, status: 'pending' },
  ] }
  const wrongFields = await run('Continue', { message: '', taskId: 'a', action: bank.tasks[1].action }, bank)
  expect(wrongFields.action).toBeUndefined()
  expect(wrongFields.taskBank.tasks[0].action.fields.title).toBe('Task A')
  const wrongId = await run('Continue', { message: '', taskId: 'b', action: bank.tasks[0].action }, bank)
  expect(wrongId.action).toBeUndefined()
})

test('a dependent create task resolves only the project ID from its completed creation receipt', async () => {
  const id = 'a'.repeat(24), bank = { tasks: [
    { id: 'project', request: 'Create Launch', dependsOn: [], status: 'completed', action: { type: 'create_project', fields: { name: 'Launch' } }, reference: { resource: { page: 'projects', id } } },
    { id: 'task', request: 'Create a Draft task in Launch', dependsOn: ['project'], status: 'pending', action: { type: 'create_task', fields: { title: 'Draft', project: 'Launch' } } },
  ] }
  const response = await run('Create a Draft task in Launch', { message: '', taskId: 'task', action: { type: 'create_task', fields: { title: 'Draft', project: `project:${id}` } } }, bank)
  expect(response.action.fields.project).toBe(`project:${id}`)
  expect(response.taskBank.tasks[1].action.fields.project).toBe(`project:${id}`)
})

test('a new desktop operation inside an existing plan preserves completed receipts and remaining work', async () => {
  const bank = { tasks: [
    { id: 'source', request: 'Research a public topic', dependsOn: [], action: { type: 'search_internet', fields: { query: 'NASA' } }, status: 'completed', result: 'Official source found' },
    { id: 'screen', request: 'Put the result into TextEdit', dependsOn: ['source'], action: { type: 'desktop_task' }, status: 'pending' },
    { id: 'reminder', request: 'Remind me later', dependsOn: ['screen'], action: { type: 'schedule_reminder', fields: {} }, status: 'pending' },
  ] }
  const response = await run('Put the result into TextEdit', { message: '', taskId: 'screen', action: { type: 'desktop_task', continuation: 'new' } }, bank)
  expect(response.action.type).toBe('desktop_task')
  expect(response.taskBank.tasks.map(task => task.id)).toEqual(['source', 'screen', 'reminder'])
  expect(response.taskBank.tasks[0].status).toBe('completed')
})

test('a model-selected genuinely new goal replaces the old graph without importing its recipients', async () => {
  const bank = { tasks: [
    { id: 'old', request: 'Send the draft to Bob', dependsOn: [], action: { type: 'send_message', fields: { recipient: 'Bob', content: 'Old draft' } }, status: 'blocked', uncertain: true },
    { id: 'later', request: 'Remind me about Bob', dependsOn: ['old'], action: { type: 'schedule_reminder', fields: {} }, status: 'pending' },
  ] }
  const response = await run('I made a new drawing; please look at the photo I will attach instead', {
    message: 'Please attach the photo.', planMode: 'new', action: null,
  }, bank)
  expect(response.taskBank.tasks).toEqual([])
  expect(JSON.stringify(response.taskBank)).not.toContain('Bob')
})

test('semantic dismissal is never blocked by an old invalid or uncertain plan', async () => {
  const bank = { tasks: [
    { id: 'old', request: 'Send old draft', dependsOn: ['missing'], action: { type: 'send_message', fields: {} }, status: 'blocked', uncertain: true },
  ] }
  const response = await run('We can pick this conversation up another day', { message: 'Talk later.', action: { type: 'dismiss' } }, bank)
  expect(response.action).toEqual({ type: 'dismiss' })
})
