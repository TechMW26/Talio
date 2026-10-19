jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))
jest.mock('@/lib/ai/aiProviderManager', () => ({ streamContent: jest.fn() }))
jest.mock('@/lib/miraRetrieval.server', () => ({ planMiraRetrieval: jest.fn(async () => ({ kind: 'none' })), MIRA_RETRIEVAL_POLICY: '' }))
import { getAuthAndDatabase } from '@/lib/auth'
import { generateContent } from '@/lib/gemini'
import { POST } from '@/app/api/ai/mira-chat/route'
import { recordMiraTaskOutcome } from '@/lib/miraTaskBank'

let bank
beforeEach(() => {
  jest.clearAllMocks()
  const user = { _id: 'A', employeeId: 'emp-A', role: 'employee', isActive: true }
  const database = { get: jest.fn(async c => c === 'users' ? user : null), create: jest.fn(), replace: jest.fn(), list: jest.fn(async () => ({ records: [] })) }
  database.transaction = async fn => fn(database)
  getAuthAndDatabase.mockResolvedValue({ success: true, user, database, tenant: { databaseName: 'test-desktop-continuation' } })
  bank = recordMiraTaskOutcome({ tasks: [{ request: 'Open YouTube Music', action: { type: 'desktop_task' }, status: 'pending' }] }, { success: true, message: 'YouTube Music is open.' })
})
const run = async (message, mode, taskBank = bank) => {
  generateContent.mockResolvedValue(JSON.stringify({ message: '', action: { type: 'desktop_task', continuation: mode }, cards: [], suggestedQuestions: [] }))
  const response = await POST(new Request('https://app.talio.in/api/ai/mira-chat', { method: 'POST', body: JSON.stringify({ message, taskBank, clientContext: { desktopComputerAvailable: true }, conversationHistory: [{ role: 'user', content: 'Open YouTube Music' }, { role: 'assistant', content: 'YouTube Music is open.' }] }) }))
  expect(response.status).toBe(200)
  return (await response.json()).response
}
test('open → play → correct retains the chain through real route and outcome transitions', async () => {
  const play = await run('Now play Yellow', 'followup')
  expect(play.action.goal).toContain('Open YouTube Music')
  expect(play.action.goal).toContain('Now play Yellow')
  const next = recordMiraTaskOutcome(play.taskBank, { success: true, message: 'Playing Yellow by another artist.' })
  const correction = await run('गलत गाना है, Coldplay वाला चलाओ', 'correction', next)
  expect(correction.action.goal).toContain('Now play Yellow')
  expect(correction.action.goal).toContain('Open YouTube Music')
  expect(correction.action.goal).toContain('Coldplay वाला चलाओ')
  expect(correction.taskBank.tasks[0].request).toBe('गलत गाना है, Coldplay वाला चलाओ')
})
test('uncertain send becomes inspect-first recovery without a magic retry phrase', async () => {
  const pending = { tasks: [{ request: 'Text Mansi on WhatsApp saying hello', action: { type: 'desktop_task' }, status: 'blocked', uncertain: true, result: 'Input delivered, not verified' }] }
  const response = await run('Check and try again', 'retry', pending)
  expect(response.action.goal).toContain('Text Mansi on WhatsApp saying hello')
  expect(response.action.goal).toContain('only if you verify it did not occur')
  expect(response.message).not.toContain('verified not completed, retry')
  const next = recordMiraTaskOutcome(response.taskBank, { success: false, uncertain: true, message: 'Destination not yet visible' })
  const again = await run('Inspect it again', 'retry', next)
  expect(again.action.goal).toContain('Text Mansi on WhatsApp saying hello')
})
test('new self-contained command does not import old targets', async () => {
  const response = await run('Send Alice an email in Gmail saying hello', 'new')
  expect(response.action.goal).toBe('Send Alice an email in Gmail saying hello')
  expect(response.taskBank.desktopHistory).toBeUndefined()
})
test('model-selected new task replaces even a blocked same-type task', async () => {
  const pending = { tasks: [{ request: 'Text Mansi on WhatsApp saying hello', action: { type: 'desktop_task' }, status: 'blocked', uncertain: true }] }
  const response = await run('Could you put some jazz on?', 'new', pending)
  expect(response.action.goal).toBe('Could you put some jazz on?')
  expect(response.taskBank.tasks[0].request).toBe('Could you put some jazz on?')
  expect(response.taskBank.desktopHistory).toBeUndefined()
})
test('casual agreement after completion is not executed', async () => {
  expect((await run('Yes', 'retry')).action).toBeUndefined()
})
