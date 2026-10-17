const fs = require('fs')
const path = require('path')
const { APP_ID, TEAM_ID, HELPER_IDS, verifyMacApp, designatedRequirement } = require('../../desktop-app/src/macSigningPolicy')

const app = '/build/Talio.app'
function signedRun(change = value => value) {
  return jest.fn(async (_, args) => {
    if (args[0] !== '--display') return { stdout: '', stderr: '' }
    const target = args[args.length - 1]
    const relative = path.relative(app, target)
    const id = relative ? HELPER_IDS[relative] : APP_ID
    return { stdout: '', stderr: change(`Identifier=${id}\nTeamIdentifier=${TEAM_ID}\nAuthority=Developer ID Application: Talio\ndesignated => ${designatedRequirement(id)}\n`, target) }
  })
}
test('stable bundle and helper identities are verified against Apple and the pinned team', async () => {
  const run = signedRun()
  await expect(verifyMacApp(app, { run })).resolves.toEqual({ appId: APP_ID, teamId: TEAM_ID })
  expect(run).toHaveBeenCalledTimes(6)
  for (const [, args] of run.mock.calls.filter(([, args]) => args[0] === '--verify')) {
    expect(args).toContain('--strict')
    expect(args).toContain('-R')
    expect(args.join(' ')).toContain('anchor apple generic')
    expect(args.join(' ')).toContain(TEAM_ID)
  }
  expect(run.mock.calls[0][1]).toContain('--deep')
})
test.each([
  text => text.replace(`TeamIdentifier=${TEAM_ID}`, 'TeamIdentifier=not set') + 'Signature=adhoc\n',
  text => text.replace(`TeamIdentifier=${TEAM_ID}`, 'TeamIdentifier=OTHERTEAM1'),
  text => text.replace(`Identifier=${APP_ID}\n`, 'Identifier=other.app\n'),
  text => text.replace(/designated => .*/, 'designated => cdhash H"123456"'),
])('rejects unstable or wrong signing metadata', async change => {
  await expect(verifyMacApp(app, { run: signedRun(change) })).rejects.toThrow('Unstable macOS signing identity')
})
test('rejects a helper with a content-derived identifier even if the app is correctly signed', async () => {
  const run = signedRun((text, target) => target.endsWith('/mira-control') ? text.replace(HELPER_IDS['Contents/Resources/mira-control'], 'mira-control-UUID') : text)
  await expect(verifyMacApp(app, { run })).rejects.toThrow('mira-control')
})
test('propagates invalid signatures, missing helpers and codesign failures', async () => {
  const run = jest.fn().mockRejectedValue(new Error('code object is not signed at all'))
  await expect(verifyMacApp(app, { run })).rejects.toThrow('not signed')
  expect(run).toHaveBeenCalledTimes(1)
})
test('macOS packaging cannot silently fall back to ad-hoc signing', () => {
  const build = require('../../desktop-app/package.json').build
  expect(build.appId).toBe(APP_ID)
  expect(build.mac.forceCodeSigning).toBe(true)
  expect(build.mac.identity).toContain(TEAM_ID)
  expect(build.mac.identity).not.toContain('Developer ID Application:') // Builder selects the distribution certificate type.
  expect(build.mac.sign).toBe('scripts/sign-mac.js')
  expect(build.mac.binaries).toEqual(Object.keys(HELPER_IDS))
  expect(build.afterSign).toBe('scripts/notarize.js')
  expect(build.mac.notarize).toBe(false) // Single explicit afterSign notary owner.
})
test('the installer checks identities before any removal or privileged replacement', () => {
  const source = fs.readFileSync('desktop-app/src/main.js', 'utf8')
  const verify = source.indexOf('await verifyMacApp(newAppPath)')
  expect(verify).toBeGreaterThan(0)
  expect(verify).toBeLessThan(source.indexOf("var rm = spawn('/bin/rm'", verify))
  expect(verify).toBeLessThan(source.indexOf("var shellCmd = '/bin/rm", verify))
  expect(source).not.toContain('tccutil reset')
})
test('release CI requires credentials and notarization rather than disabling Mac signing', () => {
  const workflow = fs.readFileSync('.github/workflows/desktop-agent-s.yml', 'utf8')
  for (const name of ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_ID_PASSWORD', 'APPLE_TEAM_ID']) expect(workflow).toContain('secrets.' + name)
  expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY: ${{ runner.os == 'macOS' && 'true' || 'false' }}")
  expect(workflow).toContain("REQUIRE_NOTARIZATION: ${{ runner.os == 'macOS' && 'true' || 'false' }}")
})
