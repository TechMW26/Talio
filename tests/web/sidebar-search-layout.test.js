import fs from 'fs'
import path from 'path'

describe('sidebar search layout', () => {
  const sidebarSources = [
    path.join(process.cwd(), 'components', 'Sidebar.js'),
    path.join(process.cwd(), 'components', 'sidebar', 'SlidingSidebar.js'),
  ].map((file) => fs.readFileSync(file, 'utf8'))

  test.each(sidebarSources)('uses a concise accessible search label', (source) => {
    expect(source).toContain('placeholder="Search"')
    expect(source).toContain('aria-label="Search"')
    expect(source).not.toContain('Find a tool')
  })

  test.each(sidebarSources)('keeps clear space below the search field', (source) => {
    expect(source).toMatch(/talio-sidebar-search[^"\n]*\bmb-5\b/)
  })
})
