import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.join(process.cwd(), 'components/Header.js'), 'utf8')
test('desktop and mobile search retain exit animations through presence boundaries', () => {
  expect(source.match(/<AnimatePresence>/g)).toHaveLength(2)
  expect(source).toContain('key="desktop-search" {...searchMotion}')
  expect(source).toContain('key="mobile-search" {...searchMotion}')
  expect(source).toContain('key="search-backdrop"')
  expect(source).toContain('exit: { opacity: 0')
})
test('search respects reduced motion and preserves horizontal centering and input focus', () => {
  expect(source).toContain('const reducedMotion = useReducedMotion()')
  expect(source).toContain("x: '-50%', transformOrigin: 'top center'")
  expect(source).toContain('duration: reducedMotion ? 0 : 0.28')
  expect(source).toContain('autoFocus')
  expect(source).toContain("e.key === 'k'")
})
