import { renderHook, act } from '@testing-library/react'
import useMiraPanelVisible from '@/hooks/useMiraPanelVisible'
import fs from 'fs'
import path from 'path'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('paints a closed frame before opening, including initial open mounts', () => {
  const { result, rerender } = renderHook(({ open }) => useMiraPanelVisible(open), { initialProps: { open: true } })
  expect(result.current).toBe(false)
  act(() => jest.advanceTimersByTime(40))
  expect(result.current).toBe(true)
  rerender({ open: false })
  expect(result.current).toBe(false)
  rerender({ open: true })
  expect(result.current).toBe(false)
  act(() => jest.advanceTimersByTime(40))
  expect(result.current).toBe(true)
})

test('rapid closing cancels pending entry frames and unmount cleans up', () => {
  const { result, rerender, unmount } = renderHook(({ open }) => useMiraPanelVisible(open), { initialProps: { open: true } })
  act(() => jest.advanceTimersByTime(17))
  rerender({ open: false })
  act(() => jest.advanceTimersByTime(100))
  expect(result.current).toBe(false)
  rerender({ open: true })
  unmount()
  expect(jest.getTimerCount()).toBe(0)
})

test('panel uses explicit matching transform transitions and keeps backdrop mounted for exit', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/MiraChatSidebar.js'), 'utf8')
  expect(source).toContain("transform: panelVisible ? 'translate3d(0, 0, 0)' : 'translate3d(-40px, 0, 0)'")
  expect(source.match(/transitionDuration: '450ms'/g)).toHaveLength(2)
  expect(source).toContain("transitionTimingFunction: panelVisible ? 'cubic-bezier(0.22, 0.65, 0.3, 1)' : 'cubic-bezier(0.4, 0, 0.6, 1)'")
  expect(source).not.toContain("isOpen ? 'translate-x-0 opacity-100'")
  expect(source).not.toContain('{isOpen && !pip && (')
  expect(source).toContain('motion-reduce:transition-none')
  expect(source).toContain('inert={!isOpen ? true : undefined}')
})
