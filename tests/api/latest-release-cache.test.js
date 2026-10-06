import { GET } from '@/app/api/latest-release/route'
import { getPublicReleaseMetadata } from '@/lib/platform/releaseCatalog.server'
jest.mock('@/lib/platform/releaseCatalog.server', () => ({ getPublicReleaseMetadata: jest.fn() }))
test('successful public metadata has a short CDN-only TTL', async () => {
  getPublicReleaseMetadata.mockResolvedValue({ versionTag: 'v1' })
  const response = await GET(new Request('https://app.test/api/latest-release'))
  expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('max-age=60')
  expect(response.headers.get('Cache-Control')).toContain('max-age=0')
})
test('missing release is not cached', async () => {
  getPublicReleaseMetadata.mockResolvedValue(null)
  const response = await GET(new Request('https://app.test/api/latest-release'))
  expect(response.status).toBe(404)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.has('Vercel-CDN-Cache-Control')).toBe(false)
})
test('provider errors are not cached', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    getPublicReleaseMetadata.mockRejectedValue(new Error('unavailable'))
    const response = await GET(new Request('https://app.test/api/latest-release'))
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  } finally { log.mockRestore() }
})
