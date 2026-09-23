jest.mock('next/server', () => ({
  NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status || 200, headers: options.headers }) },
}))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
import { getAuthAndModels } from '@/lib/auth'
import { POST } from '@/app/api/whiteboard/route'

test('uses authenticated employee identity and returns saved editor data without a second read', async () => {
  const save = jest.fn().mockResolvedValue(undefined)
  function Whiteboard(data) {
    Object.assign(this, data, { _id: 'board1', save })
    this.toObject = () => ({ ...data, _id: 'board1' })
  }
  const User = { findById: jest.fn() }
  const Employee = { findOne: jest.fn() }
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'user1', employeeId: 'employee1' }, models: { Whiteboard, User, Employee } })
  const response = await POST(new Request('http://localhost/api/whiteboard', { method: 'POST', body: JSON.stringify({ title: 'Fresh board' }) }))
  expect(response.status).toBe(201)
  expect(save).toHaveBeenCalledTimes(1)
  expect(User.findById).not.toHaveBeenCalled()
  expect(Employee.findOne).not.toHaveBeenCalled()
  expect(response.headers.get('Server-Timing')).toContain('board-create;dur=')
  expect(await response.json()).toMatchObject({ permission: 'owner', whiteboard: { title: 'Fresh board', pages: [{ id: 'page-1', objects: [] }], createdBy: 'employee1' } })
})
