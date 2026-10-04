jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitDocumentUpdate: jest.fn() }))
const { GET } = require('@/app/api/documents/route')
const { getAuthAndDatabase } = require('@/lib/auth')
const own = '111111111111111111111111'
const other = '222222222222222222222222'
describe('document list authorized scope', () => {
  let database
  beforeEach(() => {
    database = {
      get: jest.fn(async () => ({ employeeId: own })),
      getMany: jest.fn(async () => [{ _id: own, firstName: 'Test' }]),
      list: jest.fn(async collection => ({ records: collection === 'users' ? [{ employeeId: own, profileCompletion: { aadhaarFront: { url: '/api/files/proof' } } }] : [], nextCursor: null })),
    }
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'user', role: 'employee' }, database })
  })
  test('rejects another employee before querying either document store', async () => {
    const res = await GET(new Request(`https://talio.test/api/documents?employeeId=${other}`))
    expect(res.status).toBe(403)
    expect(database.list).not.toHaveBeenCalled()
  })
  test('self list includes profile uploads using the same ownership scope', async () => {
    const res = await (await GET(new Request('https://talio.test/api/documents'))).json()
    expect(res.data[0].name).toBe('Aadhaar Card (Front)')
    expect(database.list).toHaveBeenCalledWith('users', expect.objectContaining({ filters: [{ field: 'employeeId', operator: '==', value: own }] }))
  })
  test('HR aggregate list includes identity uploads without selecting an employee first', async () => {
    getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'hr', role: 'hr' }, database })
    const res = await (await GET(new Request('https://talio.test/api/documents'))).json()
    expect(res.data).toHaveLength(1)
    expect(database.list).toHaveBeenCalledWith('users', expect.objectContaining({ filters: [] }))
  })
  test('non-identity categories do not expose Aadhaar uploads', async () => {
    await GET(new Request('https://talio.test/api/documents?category=tax'))
    expect(database.list.mock.calls.every(([collection]) => collection !== 'users')).toBe(true)
  })
  test('document and identity reads overlap and deduplicate owner lookups', async () => {
    let finishDocuments
    database.list.mockImplementation(async collection => {
      if (collection === 'documents') return new Promise(resolve => { finishDocuments = resolve })
      return { records: [{ employeeId: own }], nextCursor: null }
    })
    const pending = GET(new Request('https://talio.test/api/documents'))
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(database.list.mock.calls.map(([collection]) => collection)).toEqual(['documents', 'users'])
    finishDocuments({ records: [{ _id: 'doc', employee: own, uploadedBy: own }], nextCursor: null })
    expect((await pending).status).toBe(200)
    expect(database.getMany).toHaveBeenCalledTimes(1)
    expect(database.getMany).toHaveBeenCalledWith('employees', [own])
  })
})
