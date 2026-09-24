jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/gemini', () => ({ generateContent: jest.fn() }))
const { POST } = require('@/app/api/holidays/fetch-ai/route')
const { getAuthAndModels } = require('@/lib/auth')
const { generateContent } = require('@/lib/gemini')

test('AI suggestions never become active holidays automatically', async () => {
  const create = jest.fn()
  getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'hr' }, models: { Holiday: { create } } })
  generateContent.mockResolvedValue('[{"name":"Suggested festival","date":"2026-09-01"}]')
  const response = await POST(new Request('https://talio.test/api/holidays/fetch-ai', { method: 'POST', body: JSON.stringify({ country: 'India', year: 2026 }) }))
  expect((await response.json()).requiresApproval).toBe(true)
  expect(create).not.toHaveBeenCalled()
})

test('employees cannot invoke holiday generation', async () => {
  getAuthAndModels.mockResolvedValue({ success: true, user: { role: 'employee' }, models: {} })
  expect((await POST(new Request('https://talio.test/api/holidays/fetch-ai', { method: 'POST' }))).status).toBe(403)
})
