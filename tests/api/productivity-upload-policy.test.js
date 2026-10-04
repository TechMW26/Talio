import { POST } from '@/app/api/activity/screenshot/route'
import { verifyTokenFromRequest } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { uploadScreenshot } from '@/lib/mediaStorage'
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ verifyTokenFromRequest: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/mediaStorage', () => ({ uploadScreenshot: jest.fn(), getScreenshot: jest.fn(), deleteScreenshot: jest.fn() }))
jest.mock('@/lib/officeHours', () => ({ isWithinOfficeHours: jest.fn() }))
jest.mock('@/lib/imagePipeline', () => ({ processImage: jest.fn(), ImagePipelineError: class extends Error {} }))
jest.mock('@/lib/productivityPermissions', () => ({ canViewTenantScreenshots: jest.fn() }))
beforeEach(() => {
  jest.clearAllMocks()
  verifyTokenFromRequest.mockResolvedValue({ success: true, user: { _id: 'u', role: 'employee' }, tenant: { databaseName: 'tenant-a' } })
  getFirestoreTenantDatabase.mockResolvedValue({ get: async () => ({ screenshotsEnabled: false }) })
})
test('disabled tenant drops upload before parsing bytes or storing media', async () => {
  const request = { formData: jest.fn() }
  const response = await POST(request)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ success: true, dropped: true, captureEnabled: false })
  expect(request.formData).not.toHaveBeenCalled()
  expect(uploadScreenshot).not.toHaveBeenCalled()
  expect(getFirestoreTenantDatabase).toHaveBeenCalledWith('tenant-a', expect.any(Object))
})
test('protected roles remain prohibited irrespective of tenant switch', async () => {
  verifyTokenFromRequest.mockResolvedValue({ success: true, user: { _id: 'u', role: 'hr' }, tenant: { databaseName: 'tenant-a' } })
  expect((await POST({})).status).toBe(403)
})
