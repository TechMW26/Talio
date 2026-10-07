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

test('lights the viewport during activity without rendering a cursor icon', () => {
  const { unmount } = render(<MiraActivityPointer />)
  expect(screen.queryByTestId('mira-page-glow')).toBeNull()
  const target = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 80, height: 40, right: 180, bottom: 140 }) }
  emit({ label: 'Open Tasks', phase: 'working', target })
  expect(screen.getByTestId('mira-page-glow')).toBeInTheDocument()
  expect(screen.getByTestId('shared-activity-beam')).toHaveAttribute('data-active', 'true')
  expect(screen.getByTestId('shared-activity-beam')).toHaveAttribute('data-radius', '0')
  expect(screen.getByTestId('shared-activity-beam')).not.toHaveAttribute('data-strength')
  expect(document.querySelector('img[src="/mira-cursor.png"]')).toBeNull()
  emit({ label: 'Selected Tasks', phase: 'click', target })
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
test('chat activity cannot turn off the board edge light while board work is active', () => {
  render(<MiraActivityPointer />)
  act(() => window.dispatchEvent(new CustomEvent('mira:agent-state', { detail: { active: true, source: 'board' } })))
  act(() => window.dispatchEvent(new CustomEvent('mira:agent-state', { detail: { active: true, source: 'chat' } })))
  act(() => window.dispatchEvent(new CustomEvent('mira:agent-state', { detail: { active: false, source: 'chat' } })))
  expect(screen.getByTestId('mira-page-glow')).toBeInTheDocument()
  act(() => window.dispatchEvent(new CustomEvent('mira:agent-state', { detail: { active: false, source: 'board' } })))
  expect(screen.queryByTestId('mira-page-glow')).toBeNull()
})
