import fs from 'fs'
import path from 'path'
import postcss from 'postcss'

const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
const root = postcss.parse(css)
const rules = []
root.walkRules(rule => rules.push(rule))

test('semantic headers no longer receive a forced dark surface', () => {
  const sheets = ['app/globals.css', ...fs.readdirSync(path.join(process.cwd(), 'styles')).filter(name => name.endsWith('.css')).map(name => `styles/${name}`)]
  for (const sheet of sheets) {
    postcss.parse(fs.readFileSync(path.join(process.cwd(), sheet), 'utf8')).walkRules(rule => {
      for (const selector of rule.selectors || []) {
        if (['header', 'header.bg-white', 'html.dark header', 'html.dark header.bg-white'].includes(selector)) {
          expect(rule.nodes.filter(node => node.prop?.startsWith('background'))).toEqual([])
        }
      }
    })
  }
  expect(css).toContain('header.talio-navigation-header')
})

test('native dark form fields do not receive blanket grey backgrounds', () => {
  const native = rules.filter(rule => rule.selectors?.includes('html.dark textarea'))
  for (const rule of native) expect(rule.nodes.some(node => node.prop?.startsWith('background'))).toBe(false)
})

test('transparent wrappers are scoped to fields, with opaque native options retained', () => {
  const wrapper = rules.find(rule => rule.selector === 'html body :is([data-slot="input-wrapper"], button[data-slot="trigger"][aria-haspopup="listbox"])')
  expect(wrapper.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ prop: 'background-color', value: 'transparent' })]))
  expect(wrapper.nodes.some(node => node.prop === 'outline' && node.value === 'none')).toBe(false)
  expect(rules.some(rule => rule.selector === 'html.dark select option')).toBe(true)
  expect(css).not.toContain('--heroui-content1: #18181b')
  expect(css).not.toContain('--heroui-default-100: #27272a')
})

test('inner field content has no second boundary or curved edge', () => {
  const inner = rules.find(rule => rule.selectors?.includes('html body [data-slot="input-wrapper"] input'))
  for (const [prop, value] of [['border', 'none'], ['border-radius', '0'], ['box-shadow', 'none']]) {
    expect(inner.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ prop, value, important: true })]))
  }
  expect(css).toContain('[data-slot="input-wrapper"]:focus-within')
  const focus = rules.find(rule => rule.selectors?.includes('.talio-searchable-select [data-slot="input-wrapper"][data-focus="true"]'))
  expect(focus.nodes.some(node => node.prop === 'box-shadow')).toBe(false)
})

test('wrapped searches remove inner decoration without stripping standalone search borders', () => {
  const inner = rules.find(rule => rule.selector === 'html:is(:root, .dark, .light) body [data-search-container] input')
  for (const [prop, value] of [['border', '0'], ['border-radius', '0'], ['box-shadow', 'none'], ['outline', 'none']]) {
    expect(inner.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ prop, value, important: true })]))
  }
  const focus = rules.find(rule => rule.selector === 'html:is(:root, .dark, .light) body [data-search-container]:has(input:focus-visible)')
  expect(focus.nodes.some(node => node.prop === 'outline' && node.value.startsWith('2px solid'))).toBe(true)
  const standalone = rules.find(rule => rule.selector.includes('body input:is('))
  expect(standalone.nodes.some(node => ['border', 'outline'].includes(node.prop))).toBe(false)
})

test('field layout shells do not add another outline around the wrapper', () => {
  const shell = rules.find(rule => rule.selectors?.includes('[data-slot="base"]:has(> [data-slot="input-wrapper"])'))
  expect(shell.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ prop: 'border', value: '0' }),
    expect.objectContaining({ prop: 'border-radius', value: '0' }),
  ]))
})

test('modal radius applies to the dialog itself, not inner content sections', () => {
  expect(css).not.toContain('div[role="dialog"] > section')
  expect(css).toContain('section[role="dialog"]')
})

test('tables inside cards can use the card boundary without a second rounded surface', () => {
  const table = fs.readFileSync(path.join(process.cwd(), 'components/ui/heroui/Table.js'), 'utf8')
  expect(table.match(/embedded \? 'shadow-none border-0 rounded-none bg-transparent'/g)).toHaveLength(2)
  const payslips = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/payroll/payslips/page.js'), 'utf8')
  expect(payslips).toContain('<HRMSTable embedded aria-label="Payslips table">')
})
