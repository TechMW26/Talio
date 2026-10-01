import { saveCompanySettings, validateCompanyLogo } from '@/lib/client/companySettings'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'

jest.mock('@/lib/client/uploadFile', () => ({ uploadAuthenticatedFile: jest.fn() }))
const file = { name: 'logo.png', type: 'image/png', size: 1024 }
const options = { companyId: 'company-1', values: { name: 'Example', code: 'EX', logo: '/old.png' }, logoFile: file, token: 'test' }
beforeEach(() => {
  jest.useFakeTimers()
  uploadAuthenticatedFile.mockReset().mockResolvedValue({ success: true, fileUrl: '/api/files/tenant/company/logo.png' })
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
})
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

test('saves the uploaded logo URL and reports separate phases', async () => {
  const onPhase = jest.fn(), onLogoUploaded = jest.fn()
  await saveCompanySettings({ ...options, onPhase, onLogoUploaded })
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).logo).toBe('/api/files/tenant/company/logo.png')
  expect(onPhase.mock.calls.flat()).toEqual(['Uploading logo…', 'Saving…'])
  expect(onLogoUploaded).toHaveBeenCalledWith('/api/files/tenant/company/logo.png')
  expect(jest.getTimerCount()).toBe(0)
})
test('never saves the old logo when upload fails', async () => {
  uploadAuthenticatedFile.mockRejectedValue(new Error('Storage unavailable'))
  await expect(saveCompanySettings(options)).rejects.toThrow('Storage unavailable')
  expect(global.fetch).not.toHaveBeenCalled()
})
test('rejects missing upload URL and invalid files', async () => {
  uploadAuthenticatedFile.mockResolvedValue({ success: true })
  await expect(saveCompanySettings(options)).rejects.toThrow('Logo upload failed')
  expect(() => validateCompanyLogo({ ...file, type: 'image/svg+xml' })).toThrow('PNG')
  expect(() => validateCompanyLogo({ ...file, size: 11 * 1024 * 1024 })).toThrow('10 MB')
})
test('propagates server save errors without claiming success', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'Access denied' }) })
  await expect(saveCompanySettings(options)).rejects.toThrow('Access denied')
})
test('aborts a stalled upload and releases the saving state through rejection', async () => {
  uploadAuthenticatedFile.mockImplementation((file, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
  const result = expect(saveCompanySettings(options)).rejects.toThrow('Logo upload timed out')
  await jest.advanceTimersByTimeAsync(60000)
  await result
  expect(global.fetch).not.toHaveBeenCalled()
})
test('settings-only saves preserve the existing logo', async () => {
  await saveCompanySettings({ ...options, logoFile: null })
  expect(uploadAuthenticatedFile).not.toHaveBeenCalled()
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).logo).toBe('/old.png')
})
