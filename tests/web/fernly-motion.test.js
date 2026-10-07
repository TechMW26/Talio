import { render, screen, fireEvent } from '@testing-library/react'
import FernlyMotion from '@/components/ui/FernlyMotion'
import EmployeeTabs from '@/app/dashboard/team/members/[id]/EmployeeTabs'
import fs from 'fs'

const originalObserver = global.IntersectionObserver
const originalMatchMedia = window.matchMedia
let observerCallback
beforeEach(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }))
  global.IntersectionObserver = class {
    constructor(callback) { observerCallback = callback }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterEach(() => {
  global.IntersectionObserver = originalObserver
  window.matchMedia = originalMatchMedia
})

test('cards and tabs stay still under the pointer while tab clicks still work', () => {
  const change = jest.fn()
  render(<FernlyMotion><article data-testid="card">Card</article><EmployeeTabs active="overview" onChange={change} /></FernlyMotion>)
  const card = screen.getByTestId('card'), tab = screen.getByRole('tab', { name: 'Attendance' })
  fireEvent.pointerMove(card, { clientX: 200, clientY: 100 })
  fireEvent.pointerMove(tab, { clientX: 200, clientY: 100 })
  expect(card.style.translate).toBe('')
  expect(tab.style.translate).toBe('')
  fireEvent.click(tab)
  expect(change).toHaveBeenCalledWith('attendance')
})

test('entrance animation remains available without any hover handlers', () => {
  render(<FernlyMotion><article data-testid="card">Card</article></FernlyMotion>)
  const card = screen.getByTestId('card')
  card.animate = jest.fn(() => ({ cancel: jest.fn() }))
  observerCallback([{ isIntersecting: true, target: card }])
  expect(card.animate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ duration: 850 }))
  const source = fs.readFileSync('components/ui/FernlyMotion.js', 'utf8')
  expect(source).not.toContain("addEventListener('pointermove'")
  expect(source).not.toContain('style.translate')
  expect(fs.readFileSync('app/dashboard/team/members/[id]/member.module.css', 'utf8')).not.toContain(':hover')
})
