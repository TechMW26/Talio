import fs from 'node:fs'
import path from 'node:path'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test('header has no surrounding background, border or shadow in either theme', () => {
  const css = read('app/dashboard/dashboard-layout.css')
  const header = css.match(/\.dashboard-floating-shell \.talio-navigation-header\s*\{([^}]+)\}/)[1]
  expect(header).toContain('border: 0;')
  expect(header).toContain('box-shadow: none;')
  const global = read('app/globals.css')
  expect(global).toMatch(/header\.talio-navigation-header,\s*html\.dark header\.talio-navigation-header\s*\{\s*background: transparent !important;/)
})

test('header controls use an inset corner radius and no phantom hidden-menu spacing', () => {
  const header = read('components/Header.js')
  const css = read('app/dashboard/dashboard-layout.css')
  expect(header).toContain('gap-2 sm:gap-3 flex-1 min-w-0')
  expect(header).not.toContain('space-x-2 sm:space-x-3 flex-1')
  expect(header.match(/borderRadius: 'var\(--dashboard-header-control-radius\)'/g)).toHaveLength(1)
  expect(read('components/HeaderSearch.module.css')).toContain('--search-radius: var(--dashboard-header-control-radius, 16px)')
  expect(css).toContain('calc(var(--dashboard-shell-radius) - var(--dashboard-header-inset) - 1px)')
  expect(css).toContain('padding: var(--dashboard-header-inset)')
})

test('retired call UI, API and delivery listeners are removed', () => {
  for (const file of ['components/CallAlertButton.js', 'components/CallAlertReceiver.js', 'lib/platform/firestoreCallAlerts.server.js', 'app/api/call-alert/route.js']) {
    expect(fs.existsSync(path.join(process.cwd(), file))).toBe(false)
  }
  for (const file of ['components/Header.js', 'app/dashboard/layout.js', 'contexts/SocketContext.js', 'desktop-app/src/main.js', 'desktop-app/src/socketHandler.js']) {
    expect(read(file)).not.toMatch(/CallAlert|call-alert|callAlert/)
  }
  expect(read('lib/audio.js')).not.toMatch(/PREBUILT_MESSAGES|processMessageTemplate/)
  expect(read('lib/audio.js')).toContain('export async function transcribeAudio')
  expect(read('lib/audio.js')).toContain('getMiraElevenLabsVoiceId')
})
