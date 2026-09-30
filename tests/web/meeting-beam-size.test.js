import { act, render, screen } from '@testing-library/react'
import AIActivityBeam from '@/components/ui/AIActivityBeam'

jest.mock('border-beam', () => ({ BorderBeam: ({ children, active, glowSize, brightness, strength, style }) => <div data-testid="beam" data-active={active} data-spread={glowSize} data-brightness={brightness} data-strength={strength} style={style}>{children}</div> }))
jest.mock('framer-motion', () => ({ useReducedMotion: () => false }))
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ isDarkMode: true }) }))

test('100ms fade applies in both directions and glow scales with tile area', () => {
  let resize
  const disconnect = jest.fn()
  const original = global.ResizeObserver
  global.ResizeObserver = class { constructor(callback) { resize = callback } observe() {} disconnect = disconnect }
  const view = render(<AIActivityBeam active fadeMs={100} scaleWithSize strength={1} />)
  const beam = screen.getByTestId('beam')
  expect(beam.style.animationDuration).toBe('100ms')
  act(() => resize([{ contentRect: { width: 200, height: 112 } }]))
  const small = Number(beam.dataset.spread)
  const low = Number(beam.dataset.brightness)
  act(() => resize([{ contentRect: { width: 1280, height: 720 } }]))
  expect(Number(beam.dataset.spread)).toBeGreaterThan(small)
  expect(Number(beam.dataset.brightness)).toBeGreaterThan(low)
  expect(Number(beam.dataset.spread)).toBeLessThanOrEqual(2.5)
  view.rerender(<AIActivityBeam active={false} fadeMs={100} scaleWithSize />)
  expect(screen.getByTestId('beam')).toBe(beam)
  expect(beam.dataset.active).toBe('false')
  expect(beam.style.animationDuration).toBe('100ms')
  view.unmount()
  expect(disconnect).toHaveBeenCalled()
  global.ResizeObserver = original
})

test('other AI surfaces keep library fade and glow defaults', () => {
  render(<AIActivityBeam active />)
  expect(screen.getByTestId('beam').style.animationDuration).toBe('')
  expect(screen.getByTestId('beam')).not.toHaveAttribute('data-spread')
})
