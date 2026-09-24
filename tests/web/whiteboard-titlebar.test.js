import fs from 'node:fs'
import path from 'node:path'

test('board title bar reserves native controls without affecting browser layouts', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  expect(css).toMatch(/html\[data-desktop-platform="darwin"\] \.talioboard-window-header\s*\{\s*padding-left: 112px/)
  expect(css).toMatch(/html\[data-desktop-platform="win32"\] \.talioboard-window-header\s*\{\s*padding-right: 144px/)
  expect(css).toMatch(/\.talioboard-window-header button \*\s*\{\s*-webkit-app-region: no-drag/)
})

test('loading and error states retain window-control clearance', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/talioboard/[id]/page.js'), 'utf8')
  expect(source.match(/talioboard-window-header/g)).toHaveLength(2)
  expect(source).toContain('talioboard-window-error')
})
