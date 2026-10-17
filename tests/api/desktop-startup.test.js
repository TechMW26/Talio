const fs = require('fs')
const vm = require('vm')
const source = fs.readFileSync('desktop-app/src/main.js', 'utf8')

function versionCheck(fetch) {
  const start = source.indexOf('async function checkForceUpdate()')
  const end = source.indexOf('\n/**', start)
  const showUpdateRequiredScreen = jest.fn()
  const context = {
    fetch, MIN_VERSION_CHECK_URL: 'https://app.talio.in/api/desktop/min-version',
    app: { getVersion: () => '6.0.30' }, logger: { log: jest.fn() },
    AbortSignal: { timeout: jest.fn(() => ({ deadline: 8000 })) },
    compareVersions: (a, b) => a === b ? 0 : -1,
    showUpdateRequiredScreen,
  }
  vm.runInNewContext(source.slice(start, end) + '\nthis.check = checkForceUpdate', context)
  return { context, showUpdateRequiredScreen }
}

test('minimum-version request carries a bounded deadline', async () => {
  const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ minVersion: '6.0.30' }) }))
  const { context } = versionCheck(fetch)
  expect(await context.check()).toBe(false)
  expect(context.AbortSignal.timeout).toHaveBeenCalledWith(8000)
  expect(fetch.mock.calls[0][1].signal).toEqual({ deadline: 8000 })
})

test.each(['request', 'body'])('timed out %s returns to the existing offline startup flow', async phase => {
  const failure = () => { throw new Error('TimeoutError') }
  const fetch = phase === 'request' ? failure : async () => ({ ok: true, json: failure })
  const { context, showUpdateRequiredScreen } = versionCheck(fetch)
  expect(await context.check()).toBe(false)
  expect(showUpdateRequiredScreen).not.toHaveBeenCalled()
})

test('successful minimum-version response still enforces the required upgrade', async () => {
  const { context, showUpdateRequiredScreen } = versionCheck(async () => ({ ok: true, json: async () => ({ minVersion: '6.0.31', latestVersion: '6.0.32' }) }))
  expect(await context.check()).toBe(true)
  expect(showUpdateRequiredScreen).toHaveBeenCalledWith('6.0.30', '6.0.32', undefined)
})

test('startup neither awaits permission UI nor leaves its rejection unhandled', () => {
  const startup = source.slice(source.indexOf('app.whenReady().then(async function ()'))
  expect(startup).not.toContain('await requestPermissions()')
  expect(startup).toContain('requestPermissions().catch(function ()')
  const native = fs.readFileSync('desktop-app/src/miraComputer.js', 'utf8')
  expect(native).toContain('await ensurePermissions()')
  expect(native).toContain("systemPreferences.getMediaAccessStatus('screen') !== 'granted'")
})
