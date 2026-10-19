jest.mock('../../desktop-app/node_modules/@electron/osx-sign', () => ({ signAsync: jest.fn(async () => {}) }))
jest.mock('../../desktop-app/node_modules/@electron/notarize', () => ({ notarize: jest.fn(async () => {}) }))
jest.mock('../../desktop-app/src/macSigningPolicy', () => ({
  ...jest.requireActual('../../desktop-app/src/macSigningPolicy'), verifyMacApp: jest.fn(async () => ({})),
}))
const { signAsync } = require('../../desktop-app/node_modules/@electron/osx-sign')
const { notarize } = require('../../desktop-app/node_modules/@electron/notarize')
const { verifyMacApp } = require('../../desktop-app/src/macSigningPolicy')
const signMac = require('../../desktop-app/scripts/sign-mac')
const afterSign = require('../../desktop-app/scripts/notarize').default
const context = { electronPlatformName: 'darwin', appOutDir: '/build', packager: { appInfo: { productFilename: 'Talio' } } }
const originalEnv = process.env
beforeEach(() => { jest.clearAllMocks(); process.env = {}; verifyMacApp.mockResolvedValue({}); notarize.mockResolvedValue() })
afterEach(() => { process.env = originalEnv })

test.each([undefined, '-'])('signer refuses missing/ad-hoc identity %s', async identity => {
  await expect(signMac({ app: '/build/Talio.app', identity })).rejects.toThrow('Developer ID')
  expect(signAsync).not.toHaveBeenCalled()
})
test('signer preserves Electron options and assigns stable helper identifiers synchronously', async () => {
  const base = { entitlements: 'entitlements.plist', hardenedRuntime: true, additionalArguments: ['--timestamp'] }
  await signMac({ app: '/build/Talio.app', identity: 'certificate-hash', optionsForFile: () => base })
  const options = signAsync.mock.calls[0][0]
  expect(options.optionsForFile('/build/Talio.app')).toEqual(base)
  expect(options.optionsForFile('/build/Talio.app/Contents/Resources/mira-control')).toEqual({ ...base, additionalArguments: ['--timestamp', '--identifier', 'in.talio.desktop.mira-control'] })
  expect(options.optionsForFile('/build/Talio.app/Contents/Resources/agent-s/mira-agent-s').additionalArguments).toContain('in.talio.desktop.mira-agent-s')
  expect(verifyMacApp).toHaveBeenCalledWith('/build/Talio.app')
})
test.each([{ CI: 'true' }, { REQUIRE_NOTARIZATION: 'true' }])('missing release notary credentials fail closed', async env => {
  process.env = env
  await expect(afterSign(context)).rejects.toThrow('credentials are required')
  expect(notarize).not.toHaveBeenCalled()
})
test('local signed validation may run without notarization', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  await afterSign(context)
  expect(verifyMacApp).toHaveBeenCalled()
  expect(notarize).not.toHaveBeenCalled()
  log.mockRestore()
})
test('explicit 6.0.33 exception skips notarization only after verifying signing', async () => {
  process.env = { CI: 'true', REQUIRE_NOTARIZATION: 'true', TALIO_SIGNED_UNNOTARIZED_RELEASE: '6.0.33' }
  await afterSign(context)
  expect(verifyMacApp).toHaveBeenCalledWith('/build/Talio.app')
  expect(notarize).not.toHaveBeenCalled()
})
test('signed-unnotarized exception still rejects invalid signatures', async () => {
  process.env = { CI: 'true', TALIO_SIGNED_UNNOTARIZED_RELEASE: '6.0.33' }
  verifyMacApp.mockRejectedValueOnce(new Error('Invalid signature'))
  await expect(afterSign(context)).rejects.toThrow('Invalid signature')
  expect(notarize).not.toHaveBeenCalled()
})
test.each(['true', '6.0.31', ''])('other exception values do not bypass notarization: %s', async value => {
  process.env = { CI: 'true', TALIO_SIGNED_UNNOTARIZED_RELEASE: value }
  await expect(afterSign(context)).rejects.toThrow('credentials are required')
})
test('CI notarization failure prevents release', async () => {
  process.env = { CI: 'true', APPLE_KEYCHAIN_PROFILE: 'test-profile' }
  notarize.mockRejectedValueOnce(new Error('Apple unavailable'))
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  await expect(afterSign(context)).rejects.toThrow('Apple unavailable')
  error.mockRestore()
})
test('valid notarization credentials reach Apple only after signature validation', async () => {
  process.env = { CI: 'true', APPLE_KEYCHAIN_PROFILE: 'test-profile' }
  await afterSign(context)
  expect(notarize).toHaveBeenCalledWith({ appPath: '/build/Talio.app', keychainProfile: 'test-profile' })
  expect(verifyMacApp.mock.invocationCallOrder[0]).toBeLessThan(notarize.mock.invocationCallOrder[0])
})
test('non-macOS builds do not need Apple credentials', async () => {
  process.env = { CI: 'true' }
  await afterSign({ ...context, electronPlatformName: 'win32' })
  expect(verifyMacApp).not.toHaveBeenCalled()
  expect(notarize).not.toHaveBeenCalled()
})
