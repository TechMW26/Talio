import { act, render, screen } from '@testing-library/react'
import MiraActivityPointer from '@/components/ui/MiraActivityPointer'
import fs from 'fs'
import path from 'path'

jest.mock('@/components/ui/AIActivityBeam', () => function MockBeam({ active, borderRadius, strength }) {
  return <div data-testid="shared-activity-beam" data-active={String(active)} data-radius={borderRadius} data-strength={strength} />
})

const emit = detail => act(() => window.dispatchEvent(new CustomEvent('mira:activity', { detail })))
beforeEach(() => jest.useFakeTimers())
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers() })

test('uses the supplied cursor and lights the viewport only during activity', () => {
  const { unmount } = render(<MiraActivityPointer />)
  expect(screen.queryByTestId('mira-page-glow')).toBeNull()
  const target = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 80, height: 40, right: 180, bottom: 140 }) }
  emit({ label: 'Open Tasks', phase: 'working', target })
  expect(screen.getByTestId('mira-page-glow')).toBeInTheDocument()
  expect(screen.getByTestId('shared-activity-beam')).toHaveAttribute('data-active', 'true')
  expect(screen.getByTestId('shared-activity-beam')).toHaveAttribute('data-radius', '0')
  expect(screen.getByTestId('shared-activity-beam')).not.toHaveAttribute('data-strength')
  const pointer = screen.getByRole('status', { name: 'MIRA activity' })
  expect(pointer.style.transform).toBe('translate3d(140px, 120px, 0)')
  expect(pointer.querySelector('img').getAttribute('src')).toBe('/mira-cursor.png')
  expect(pointer.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0)
  emit({ label: 'Selected Tasks', phase: 'click', target })
  expect(pointer.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1)
  act(() => jest.advanceTimersByTime(1800))
  expect(screen.queryByTestId('mira-page-glow')).toBeNull()
  unmount()
  expect(document.querySelector('[aria-label="MIRA activity"]')).toBeNull()
})

test('viewport glow inherits page corners without imposing a rounded frame or intercepting clicks', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'components/ui/MiraActivityPointer.module.css'), 'utf8')
  const glow = css.match(/\.pageGlow\s*\{([\s\S]*?)\}/)[1]
  expect(glow).toContain('border-radius: inherit')
  expect(glow).toContain('overflow: hidden')
  expect(glow).toContain('pointer-events: none')
  expect(glow).not.toContain('box-shadow')
  expect(css).not.toContain('edgePulse')
})
test('board agent activity keeps the edge light on independently of cursor completion', () => {
  render(<MiraActivityPointer />)
  act(() => window.dispatchEvent(new CustomEvent('mira:agent-state', { detail: { active: true } })))
  emit({ label: 'Done', phase: 'done' })
  act(() => jest.advanceTimersByTime(2000))
  expect(screen.getByTestId('mira-page-glow')).toBeInTheDocument()
  act(() => window.dispatchEvent(new CustomEvent('mira:agent-state', { detail: { active: false } })))
  expect(screen.queryByTestId('mira-page-glow')).toBeNull()
})
