import fs from 'fs'
import path from 'path'

test('loading and mounted dashboard headers share the sidebar surface', () => {
  const header = fs.readFileSync(path.join(process.cwd(), 'components/Header.js'), 'utf8')
  const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const sidebar = fs.readFileSync(path.join(process.cwd(), 'components/sidebar/IconStrip.js'), 'utf8')
  expect(header.match(/className="talio-navigation-header /g)).toHaveLength(2)
  expect(css).toMatch(/html\.dark header\.talio-navigation-header\s*\{\s*background-color: var\(--color-bg-sidebar, #111111\) !important;/)
  expect(sidebar).toContain("backgroundColor: 'var(--color-bg-sidebar)'")
})

test('later card styles cannot override the shared navigation background', () => {
  const cards = fs.readFileSync(path.join(process.cwd(), 'styles/card-redesign.css'), 'utf8')
  const shell = fs.readFileSync(path.join(process.cwd(), 'styles/ui-components.css'), 'utf8')
  expect(cards).not.toMatch(/(?:html\.dark\s+)?header\.talio-navigation-header\s*[,\{]/)
  expect(shell).toMatch(/\.talio-sidebar-shell\s*\{[^}]*background: var\(--color-bg-sidebar\);/)
})
