import fs from 'fs'
import path from 'path'
import postcss from 'postcss'

const main = fs.readFileSync(path.join(process.cwd(), 'desktop-app/src/main.js'), 'utf8')
const css = postcss.parse(fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8'))

test('desktop injection only makes the navigation header draggable', () => {
  expect(main).toContain('header.talio-navigation-header { position: relative !important; -webkit-app-region: drag; }')
  expect(main).not.toContain('header * { -webkit-app-region: drag; }')
  expect(main).not.toContain("'header { padding-right: 140px")
  expect(main).toContain('document.querySelector("header.talio-navigation-header")')
})

test('desktop interactive targets and dialog descendants explicitly opt out of dragging', () => {
  expect(main).toContain('[role="dialog"] *')
  expect(main).toContain('[role="alertdialog"] * { -webkit-app-region: no-drag !important; }')
  let rule
  css.walkRules(candidate => {
    if (candidate.selector.includes('header:not(.talio-navigation-header):not(.talioboard-window-header)')) rule = candidate
  })
  expect(rule).toBeDefined()
  for (const target of ['button', 'input', 'label', '[tabindex]', '[role="button"]', '[role="dialog"]', '[role="alertdialog"]']) {
    expect(rule.selector).toContain(target)
  }
  expect(rule.selectors.every(selector => selector.startsWith('html[data-desktop-platform]'))).toBe(true)
  for (const prop of ['-webkit-app-region', 'app-region']) {
    expect(rule.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ prop, value: 'no-drag', important: true })]))
  }
})
