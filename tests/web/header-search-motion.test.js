import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.join(process.cwd(), 'components/HeaderSearch.js'), 'utf8')
test('one inline search has attached animated results without desktop or mobile overlays', () => {
  const header = fs.readFileSync(path.join(process.cwd(), 'components/Header.js'), 'utf8')
  expect(header.match(/<HeaderSearch \/>/g)).toHaveLength(1)
  expect(header).not.toContain('showMobileSearch')
  expect(source.match(/<AnimatePresence>/g)).toHaveLength(1)
  expect(source).toContain('key="header-search-results"')
  expect(source).not.toContain('search-backdrop')
  expect(source.match(/<input\b/g)).toHaveLength(1)
  expect(source).toContain('<AIActivityBeam active={busy}')
})
test('inline expansion respects reduced motion and retains shortcut focus', () => {
  expect(source).toContain('const reducedMotion = useReducedMotion()')
  expect(source).toContain('duration: reducedMotion ? 0 : 0.18')
  expect(source).toContain('inputRef.current?.focus()')
  expect(source).toContain("event.key.toLowerCase() === 'k'")
  const css = fs.readFileSync(path.join(process.cwd(), 'components/HeaderSearch.module.css'), 'utf8')
  expect(css).toContain('position: absolute')
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
})

test('header search has no idle, active or result borders; activity glow remains search-only', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'components/HeaderSearch.module.css'), 'utf8')
  expect(css).not.toMatch(/border(?:-bottom|-color)?:\s*(?:1px|#93b4fa)/)
  expect(css).not.toMatch(/outline:\s*\d+px/)
  expect(css).toContain('.control[data-search-container]:has(input:focus-visible) { outline: none !important; box-shadow: none; border: 0; }')
  expect(source).toContain('<AIActivityBeam active={busy}')
})
