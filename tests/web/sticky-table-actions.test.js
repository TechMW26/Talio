import fs from 'fs'
import path from 'path'
import postcss from 'postcss'

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
test('Assets and other native action tables explicitly mark the action header', () => {
  for (const file of ['assets', 'employees', 'attendance', 'documents', 'users', 'designations', 'recruitment', 'leave/requests', 'leave/approvals', 'leave/allocations', 'helpdesk/manage']) {
    expect(read(`app/dashboard/${file}/page.js`)).toMatch(/<th\b[^>]*data-sticky-actions="true"[^>]*>\s*Actions?\s*<\/th>/)
  }
})
test('shared sticky rules pin the right edge with opaque surfaces and exclude spanning rows', () => {
  const ast = postcss.parse(read('app/globals.css'))
  const rules = []
  ast.walkRules(rule => { if (rule.selector.includes('data-sticky-actions')) rules.push(rule) })
  const declarations = Object.fromEntries(rules[0].nodes.map(node => [node.prop, node.value]))
  expect(declarations).toMatchObject({ position: 'sticky', right: '0', 'z-index': '2', 'background-color': '#fff' })
  expect(rules[0].selector).toContain('th[data-sticky-actions]:last-child')
  expect(rules.every(rule => rule.selector.includes(':not([colspan])'))).toBe(true)
  expect(rules.some(rule => rule.selector.startsWith('.dark '))).toBe(true)
  expect(rules.some(rule => rule.selector.includes(':focus-within'))).toBe(true)
})
test('shared HeroUI table supports action-key auto detection and explicit opt in', () => {
  const source = read('components/ui/heroui/Table.js')
  expect(source).toContain('stickyActions = /^(actions?|operations)$/i')
  expect(source.match(/data-sticky-actions-table=\{stickyActions \|\| undefined\}/g)).toHaveLength(2)
})
