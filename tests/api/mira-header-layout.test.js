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
