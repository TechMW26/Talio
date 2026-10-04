jest.mock('@/lib/platform/runtime', () => ({
  getRuntimeCapabilities: jest.fn(() => ({ runtime: 'development', managedRealtime: false })),
  getVercelReadiness: jest.fn(),
}))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreProvisioningContext: jest.fn() }))
import { GET } from '@/app/api/health/route'
import { getFirestoreProvisioningContext } from '@/lib/platform/firestoreApplication.server'

test('client capability check is successful and performs no database reads', async () => {
  const response = await GET(new Request('http://localhost/api/health'))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'ok', capabilities: { managedRealtime: false } })
  expect(getFirestoreProvisioningContext).not.toHaveBeenCalled()
})
