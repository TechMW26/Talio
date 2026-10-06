import fs from 'fs'
import path from 'path'
import postcss from 'postcss'

test('shared Select triggers retain rounded corners independently of borderless layout shells', () => {
  const css = postcss.parse(fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8'))
  let trigger
  css.walkRules(rule => {
    if (rule.selector === 'html body button[data-slot="trigger"][aria-haspopup="listbox"]') trigger = rule
  })
  expect(trigger).toBeDefined()
  expect(trigger.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ prop: 'border-radius', value: '0.75rem', important: true }),
  ]))
  expect(trigger.nodes.some(node => node.prop === 'overflow')).toBe(false)
})
