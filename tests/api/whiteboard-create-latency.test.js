jest.mock('next/server', () => ({
  NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200, headers: options.headers }) },
}))
jest.mock('@/lib/whiteboards.server', () => ({ getWhiteboardContext: jest.fn(), boardError: (message, status) => Object.assign(new Error(message), { status }) }))
import { getWhiteboardContext } from '@/lib/whiteboards.server'
import { POST } from '@/app/api/whiteboard/route'

test('uses authenticated employee identity and returns saved editor data without a second read', async () => {
  const store = { create: jest.fn(), get: jest.fn() }
  getWhiteboardContext.mockResolvedValue({ userId: 'user1', employeeId: 'employee1', store })
  const response = await POST(new Request('http://localhost/api/whiteboard', { method: 'POST', body: JSON.stringify({ title: 'Fresh board' }) }))
  expect(response.status).toBe(201)
  expect(store.create).toHaveBeenCalledTimes(1)
  expect(store.get).not.toHaveBeenCalled()
  expect(response.headers.get('Server-Timing')).toContain('board-create;dur=')
  expect(await response.json()).toMatchObject({ permission: 'owner', whiteboard: { title: 'Fresh board', pages: [{ id: 'page-1', objects: [] }], createdBy: 'employee1' } })
})
