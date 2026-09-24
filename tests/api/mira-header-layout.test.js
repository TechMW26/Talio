import fs from 'fs'

test('MIRA panel reserves header height plus a gap without changing PiP height', () => {
  const styles = fs.readFileSync('app/globals.css', 'utf8')
  const panel = fs.readFileSync('components/MiraChatSidebar.js', 'utf8')
  expect(styles).toContain('--mira-panel-top: max(73px, calc(var(--desktop-safe-top, 0px) + 12px))')
  expect(panel).toContain("height: pip ? 'auto' : 'calc(100dvh - var(--mira-panel-top, 73px) - 12px)'")
  expect(panel).toContain('max(var(--mira-panel-top, 73px)')
})

test('header exposes open state and creative active and thinking labels', () => {
  const header = fs.readFileSync('components/Header.js', 'utf8')
  expect(header).toContain('aria-expanded={isMiraOpen}')
  expect(header).toContain("isMiraOpen ? (isThinking ? 'On it…' : 'Mira is here') : 'Ask Mira'")
  expect(header).toContain('motion-safe:animate-pulse')
})

test('opening collapses the smiley slot with panel-timed motion and reduced-motion support', () => {
  const styles = fs.readFileSync('app/globals.css', 'utf8')
  const header = fs.readFileSync('components/Header.js', 'utf8')
  expect(header).toContain('mira-header-avatar')
  expect(styles).toContain('.mira-header-pill[aria-expanded="true"] .mira-header-avatar { width: 0; opacity: 0; transform: scale(0); }')
  expect(styles).toContain('width 300ms ease-out')
  expect(styles).toContain('min-height: 40px')
  expect(styles).toContain('.mira-header-pill, .mira-header-avatar, .mira-header-label { transition: none; }')
})
