jest.mock('@/lib/platform/releaseCatalog.server', () => ({ fetchLatestGitHubRelease: jest.fn() }))
import { fetchLatestGitHubRelease } from '@/lib/platform/releaseCatalog.server'
import { GET } from '@/app/api/desktop/min-version/route'
test('desktop updater reads the shared release catalog and does not cache its HTTP response', async () => {
  fetchLatestGitHubRelease.mockResolvedValue({ tag_name: 'v6.0.7' })
  const response = await GET(new Request('http://localhost/api/desktop/min-version', { headers: { 'x-app-version': '6.0.6' } }))
  expect(await response.json()).toMatchObject({ latestVersion: '6.0.7', clientVersion: '6.0.6' })
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(fetchLatestGitHubRelease).toHaveBeenCalledTimes(1)
})
