import { act, render } from '@testing-library/react'
import Lanyard from '@/src/component/Lanyard'
import fs from 'node:fs'
jest.mock('@/src/component/Lanyard.css', () => ({}))

test('ribbon is drawn from viewport zero outside the page clipping boundary', () => {
  let frame
  const animation = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1 })
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  let top = 180
  const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 120, top, width: 300, height: 650 }))
  const width = jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
  const view = render(<Lanyard employee={{ name: 'Test', companyName: 'Talio' }} />)
  const ribbon = document.querySelector('.lanyard-svg')
  expect(ribbon.parentElement).toBe(document.body)
  expect(view.container.contains(ribbon)).toBe(false)
  act(() => frame(10))
  expect(ribbon.querySelector('.lanyard-path').getAttribute('d')).toMatch(/^M 270 0 Q /)
  const before = ribbon.querySelector('.lanyard-path').getAttribute('d')
  top = 100
  act(() => frame(10))
  expect(ribbon.querySelector('.lanyard-path').getAttribute('d')).toMatch(/^M 270 0 Q /)
  expect(ribbon.querySelector('.lanyard-path').getAttribute('d')).not.toBe(before)
  view.unmount()
  expect(document.querySelector('.lanyard-svg')).toBeNull()
  animation.mockRestore(); cancel.mockRestore(); rect.mockRestore(); width.mockRestore()
})

test('viewport ribbon cannot intercept header input or clicks', () => {
  const css = fs.readFileSync('src/component/Lanyard.css', 'utf8')
  const svg = css.match(/\.lanyard-svg\s*\{([^}]+)\}/)[1]
  expect(svg).toContain('position: fixed')
  expect(svg).toContain('inset: 0')
  expect(svg).toContain('pointer-events: none')
  const source = fs.readFileSync('src/component/Lanyard.jsx', 'utf8')
  expect(source).not.toContain('headerBottom')
  expect(source).toContain('const ay = 0;')
})
