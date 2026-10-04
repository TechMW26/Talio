jest.mock('@/lib/auth', () => ({ verifyTokenFromRequest: jest.fn(), getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/documentAccess.server', () => ({ canReadDocumentUpload: jest.fn() }))
jest.mock('@/lib/platform/blobStorage.server', () => ({ ...jest.requireActual('@/lib/platform/blobStorage.server'), getTenantBlob: jest.fn() }))

import { verifyTokenFromRequest } from '@/lib/auth'
import { getTenantBlob, getBlobStreamLength } from '@/lib/platform/blobStorage.server'
import { GET } from '@/app/api/files/[...path]/route'

const params = { path: ['tenants', 'talio_company_test', 'uploads', 'user', 'file.txt'] }
const request = () => new Request('https://example.invalid/api/files/tenants/talio_company_test/uploads/user/file.txt')
const reply = headers => ({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('hello')); controller.close() } }), headers: new Headers(headers), blob: { size: 0, contentType: 'text/plain', etag: 'test-etag' } })

describe('private Blob delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    verifyTokenFromRequest.mockResolvedValue({ success: true, tenant: { databaseName: 'talio_company_test' } })
  })
  test('does not turn unknown/compressed response sizes into an empty download', async () => {
    getTenantBlob.mockResolvedValue(reply({ 'content-encoding': 'br' }))
    const response = await GET(request(), { params })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('cache-control')).toContain('private')
    expect(await response.text()).toBe('hello')
  })
  test('preserves a known uncompressed length, including genuine zero-byte files', async () => {
    getTenantBlob.mockResolvedValue(reply({ 'content-length': '5' }))
    const response = await GET(request(), { params })
    expect(response.headers.get('content-length')).toBe('5')
    expect(await response.text()).toBe('hello')
    expect(getBlobStreamLength(reply({ 'content-length': '0' }))).toBe(0)
    expect(getBlobStreamLength(reply({ 'content-encoding': 'br', 'content-length': '3' }))).toBeNull()
    expect(getBlobStreamLength(reply({ 'content-length': 'invalid' }))).toBeNull()
  })
  test('keeps tenant isolation and authentication checks before storage reads', async () => {
    const denied = await GET(request(), { params: { path: ['tenants', 'talio_company_other', 'uploads', 'file.txt'] } })
    expect(denied.status).toBe(403)
    verifyTokenFromRequest.mockResolvedValue({ success: false })
    expect((await GET(request(), { params })).status).toBe(401)
    expect(getTenantBlob).not.toHaveBeenCalled()
  })
  test.each(['images', 'screenshots', 'meetingAudio', 'recruitmentResumes', 'resume-parts', 'mira-images', 'call-alerts'])('private %s cannot bypass its dedicated ACL through generic files', async category => {
    expect((await GET(request(), { params: { path: ['tenants', 'talio_company_test', category, 'owner', 'media'] } })).status).toBe(403)
    expect(getTenantBlob).not.toHaveBeenCalled()
  })
})
