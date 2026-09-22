jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitDocumentUpdate: jest.fn() }))
const { GET } = require('@/app/api/documents/route')
const { getAuthAndModels } = require('@/lib/auth')
const own = '111111111111111111111111'
const other = '222222222222222222222222'
function query(value) {
  const q = { then: resolve => Promise.resolve(value).then(resolve), lean: async () => value }
  for (const method of ['select', 'populate', 'sort']) q[method] = () => q
  return q
}
describe('document list authorized scope', () => {
  let models
  beforeEach(() => {
    models = {
      User: { findById: () => query({ employeeId: own }), find: jest.fn(() => query([{ employeeId: own, profileCompletion: { aadhaarFront: { url: '/api/files/proof' } } }])) },
      Employee: { find: jest.fn(() => query([{ _id: own, firstName: 'Test' }])) },
      Document: { find: jest.fn(() => query([])) },
    }
    getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'user', role: 'employee' }, models })
  })
  test('rejects another employee before querying either document store', async () => {
    const res = await GET(new Request(`https://talio.test/api/documents?employeeId=${other}`))
    expect(res.status).toBe(403)
    expect(models.Document.find).not.toHaveBeenCalled()
    expect(models.User.find).not.toHaveBeenCalled()
  })
  test('self list includes profile uploads using the same ownership scope', async () => {
    const res = await (await GET(new Request('https://talio.test/api/documents'))).json()
    expect(res.data[0].name).toBe('Aadhaar Card (Front)')
    expect(models.User.find).toHaveBeenCalledWith(expect.objectContaining({ employeeId: own }))
  })
  test('HR aggregate list includes identity uploads without selecting an employee first', async () => {
    getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'hr', role: 'hr' }, models })
    const res = await (await GET(new Request('https://talio.test/api/documents'))).json()
    expect(res.data).toHaveLength(1)
    expect(models.User.find).toHaveBeenCalledWith(expect.objectContaining({ employeeId: { $ne: null } }))
  })
  test('non-identity categories do not expose Aadhaar uploads', async () => {
    await GET(new Request('https://talio.test/api/documents?category=tax'))
    expect(models.User.find).not.toHaveBeenCalled()
  })
})
