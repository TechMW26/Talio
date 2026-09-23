import { act, renderHook } from '@testing-library/react'
import useMiraSidebarDrag, { clampMiraSidebarPosition } from '@/hooks/useMiraSidebarDrag'

test('clamps the full-height sidebar inside the viewport', () => {
  expect(clampMiraSidebarPosition({ x: 9999, y: -100 }, { width: 1200, height: 800 }, { width: 460, height: 776 })).toEqual({ x: 728, y: 12 })
  expect(clampMiraSidebarPosition({ x: 500, y: 300 }, { width: 375, height: 700 }, { width: 351, height: 676 })).toEqual({ x: 12, y: 12 })
})

function pointer(target, overrides = {}) {
  return { currentTarget: target, target, pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 30, preventDefault: jest.fn(), ...overrides }
}
function toolbar() {
  const panel = document.createElement('div')
  panel.setAttribute('role', 'dialog')
  panel.getBoundingClientRect = () => ({ left: 12, top: 12 })
  const bar = document.createElement('div')
  bar.setPointerCapture = jest.fn()
  bar.hasPointerCapture = () => false
  panel.appendChild(bar)
  return bar
}
test('drags by the toolbar, ignores controls, and stops outside sidebar mode', () => {
  jest.useFakeTimers()
  const bar = toolbar()
  const { result, rerender } = renderHook(({ enabled }) => useMiraSidebarDrag(enabled), { initialProps: { enabled: true } })
  const button = document.createElement('button')
  bar.appendChild(button)
  act(() => result.current.handlers.onPointerDown(pointer(bar, { target: button })))
  expect(result.current.dragging).toBe(false)
  act(() => result.current.handlers.onPointerDown(pointer(bar)))
  act(() => result.current.handlers.onPointerMove(pointer(bar, { clientX: 200 })))
  act(() => jest.advanceTimersByTime(20))
  expect(result.current.position.x).toBe(172)
  expect(result.current.dragging).toBe(true)
  rerender({ enabled: false })
  expect(result.current.dragging).toBe(false)
  act(() => result.current.handlers.onPointerDown(pointer(bar)))
  act(() => result.current.handlers.onPointerMove(pointer(bar, { clientX: 300 })))
  expect(result.current.position.x).toBe(172)
  rerender({ enabled: true })
  expect(result.current.position.x).toBe(172)
  jest.useRealTimers()
})
test('keyboard movement works only on the handle and resize restores safe bounds', () => {
  const bar = toolbar()
  const { result } = renderHook(() => useMiraSidebarDrag(true))
  act(() => result.current.handlers.onKeyDown(pointer(bar, { key: 'ArrowRight' })))
  expect(result.current.position.x).toBe(32)
  const width = window.innerWidth
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
  act(() => window.dispatchEvent(new Event('resize')))
  expect(result.current.position.x).toBe(12)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
})
