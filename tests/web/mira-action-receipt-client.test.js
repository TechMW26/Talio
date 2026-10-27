import { refreshMiraExecutionReceipt } from '@/lib/miraActionReceiptClient'
const bank = () => ({ tasks: [
  { id: 'create', request: 'Create draft task', status: 'blocked', uncertain: true, executionId: 'turn:one', action: { type: 'create_task', fields: { title: 'Draft' } }, dependsOn: [] },
  { id: 'share', request: 'Share the task', status: 'pending', action: { type: 'send_message', fields: {} }, dependsOn: ['create'] },
] })

test('a completed server receipt recovers a lost write result without any effect request', async () => {
  const fetcher = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, found: true, state: 'completed', outcome: { success: true, message: 'Created', resource: { id: 'task-1', page: 'tasks' } } }) }))
  const next = await refreshMiraExecutionReceipt(bank(), { token: 'test', fetcher })
  expect(next.tasks[0]).toMatchObject({ status: 'completed', uncertain: false, reference: { resource: { id: 'task-1' } } })
  expect(next.tasks[1].status).toBe('pending')
  const [url, options] = fetcher.mock.calls[0]
  expect(url).toContain('requestId=turn%3Aone')
  expect(url).toContain('type=create_task')
  expect(options.method).toBeUndefined()
  expect(options.body).toBeUndefined()
})

test.each([
  { success: true, found: false },
  { success: true, found: true, state: 'pending' },
  { success: true, found: true, state: 'uncertain', outcome: { success: false, uncertain: true } },
  { success: false },
])('unproven outcomes never unlock a dependency: %p', async body => {
  const previous = bank(), fetcher = jest.fn(async () => ({ ok: true, json: async () => body }))
  expect(await refreshMiraExecutionReceipt(previous, { fetcher })).toBe(previous)
})
test('ordinary completed and non-server actions make no receipt request', async () => {
  const fetcher = jest.fn(), previous = bank()
  previous.tasks[0].uncertain = false
  await refreshMiraExecutionReceipt(previous, { fetcher })
  previous.tasks[0].uncertain = true; previous.tasks[0].action.type = 'desktop_task'
  await refreshMiraExecutionReceipt(previous, { fetcher })
  expect(fetcher).not.toHaveBeenCalled()
})
test('cancellation during receipt lookup stops the turn without changing its ledger', async () => {
  const controller = new AbortController(), previous = bank()
  const fetcher = jest.fn(async () => { controller.abort(); return { ok: true, json: async () => ({ success: true, found: true, state: 'completed', outcome: { success: true } }) } })
  await expect(refreshMiraExecutionReceipt(previous, { fetcher, signal: controller.signal })).rejects.toBeDefined()
  expect(previous.tasks[0].status).toBe('blocked')
})
