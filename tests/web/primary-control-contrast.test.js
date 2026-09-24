import fs from 'fs'
import path from 'path'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

test('recruitment view switch uses paired primary text and exposes its selected state', () => {
  const source = read('app/dashboard/recruitment/candidates/page.js')
  expect(source).not.toContain('bg-primary text-white')
  expect(source.match(/bg-primary text-primary-foreground/g)).toHaveLength(2)
  expect(source).toContain("aria-pressed={viewMode === 'list'}")
  expect(source).toContain("aria-pressed={viewMode === 'pipeline'}")
})

test('task view switch has theme-aware foreground and legacy controls retain a contrast guard', () => {
  expect(read('app/dashboard/projects/my-tasks/page.js')).not.toContain("'bg-primary text-white'")
  const css = read('app/globals.css')
  expect(css).toMatch(/html\.dark \.bg-primary\.text-white,\s*html\.dark \.bg-primary-500\.text-white,\s*html\.dark \.bg-primary-600\.text-white\s*\{\s*color:#111111;/)
})
