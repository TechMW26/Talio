import fs from 'fs'
import path from 'path'

test('search fields and HeroUI inner inputs let their container surface show through', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const block = css.slice(css.indexOf('/* Search containers own'), css.indexOf('/* Floating AI surfaces'))
  expect(block).toContain('[type="search"]')
  expect(block).toContain('[placeholder*="search" i]')
  expect(block).toContain('[data-slot="input-wrapper"] input')
  expect(block).toContain('background: transparent !important')
  expect(block).not.toContain('outline: none')
  expect(block).not.toContain('color:')
})

test('team search delegates its border to its focusable container', () => {
  const component = fs.readFileSync(path.join(process.cwd(), 'components/widgets/TeamAttendanceWidget.js'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'components/widgets/TeamAttendanceWidget.module.css'), 'utf8')
  expect(component).toContain('className={styles.search} data-search-container')
  expect(css).toContain('.search:focus-within')
})
