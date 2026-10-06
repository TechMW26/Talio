import fs from 'fs'
import path from 'path'

const base = path.join(process.cwd(), 'app/dashboard/team/members/[id]')
const css = fs.readFileSync(path.join(base, 'member.module.css'), 'utf8')
const page = fs.readFileSync(path.join(base, 'page.js'), 'utf8')

test('all employee slides share a flexible full-height content area', () => {
  expect(css).toMatch(/\.slide \{[^}]*flex: 1;[^}]*min-height: 0;[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow: auto;/)
  expect(css).toMatch(/\.slide > section \{[^}]*flex: 1 0 auto;[^}]*margin-top: 0;/)
  expect(css).toMatch(/\.slide > \.detailGrid \{[^}]*flex: 1 0 auto;[^}]*grid-template-rows: minmax\(min-content, 1fr\) auto;/)
})

test('inactive legacy panels do not consume height in other tabs', () => {
  expect(page).toContain("hidden={!['overview', 'tasks', 'reviews'].includes(activeTab)} className={styles.legacyPanels}")
  expect(css).toContain('.slide [hidden] { display: none !important; }')
  expect(css).toContain('.slide[data-slide="reviews"] .fillPanel > :last-child { flex: 1 0 auto; }')
})
