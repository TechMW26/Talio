import { act, render, screen } from '@testing-library/react'
import AIActivityBeam from '@/components/ui/AIActivityBeam'

jest.mock('border-beam', () => ({ BorderBeam: ({ children, active, glowSize, brightness, strength, style }) => <div data-beam="test" data-testid="beam" data-active={active} data-spread={glowSize} data-brightness={brightness} data-strength={strength} style={style}>{children}</div> }))
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
  expect(Number(beam.dataset.spread)).toBeGreaterThan(2.5)
  expect(Number(beam.style.getPropertyValue('--pulse-glow-boost'))).toBeGreaterThan(2)
  expect(Number(beam.style.getPropertyValue('--beam-inner-opacity'))).toBeGreaterThan(1)
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

test('small cards retain exact previous styling and large boosts reset after shrinking', () => {
  let resize
  const original = global.ResizeObserver
  global.ResizeObserver = class { constructor(callback) { resize = callback } observe() {} disconnect() {} }
  const view = render(<AIActivityBeam active scaleWithSize strength={1} />)
  const beam = screen.getByTestId('beam')
  for (const [width, height] of [[176, 99], [320, 180], [480, 270]]) {
    act(() => resize([{ contentRect: { width, height } }]))
    const previousScale = Math.round(Math.max(0, Math.min(1, (Math.sqrt(width * height) - 140) / 660)) * 100) / 100
    expect(Number(beam.dataset.spread)).toBeCloseTo(.9 + previousScale * 1.6)
    expect(Number(beam.dataset.brightness)).toBeCloseTo(1.2 + previousScale * .8)
    expect(Number(beam.dataset.strength)).toBeCloseTo(.85 + previousScale * .15)
    expect(beam.style.getPropertyValue('--pulse-glow-boost')).toBe('1')
  }
  act(() => resize([{ contentRect: { width: 1920, height: 1080 } }]))
  expect(Number(beam.style.getPropertyValue('--pulse-glow-boost'))).toBe(3)
  expect(Number(beam.dataset.spread)).toBeLessThanOrEqual(3.25)
  expect(Number(beam.dataset.brightness)).toBeLessThanOrEqual(3.2)
  act(() => resize([{ contentRect: { width: 320, height: 180 } }]))
  expect(beam.style.getPropertyValue('--pulse-glow-boost')).toBe('1')
  expect(screen.getByTestId('beam')).toBe(beam)
  view.unmount()
  global.ResizeObserver = original
})

test('voice volume smoothly controls strength and flow speed without remounting', () => {
  let frame
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1 })
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const voiceLevelRef = { current: 0.1 }
  const view = render(<AIActivityBeam active fadeMs={100} voiceLevelRef={voiceLevelRef} />)
  const beam = screen.getByTestId('beam')
  act(() => frame(0))
  const quietStrength = Number(beam.style.getPropertyValue('--beam-strength'))
  act(() => frame(16))
  const quietStep = parseFloat(beam.style.getPropertyValue('--beam-hue-base'))
  voiceLevelRef.current = 0.9
  act(() => frame(32))
  expect(Number(beam.style.getPropertyValue('--beam-strength'))).toBeGreaterThan(quietStrength)
  expect(parseFloat(beam.style.getPropertyValue('--beam-hue-base')) - quietStep).toBeGreaterThan(quietStep)
  expect(screen.getByTestId('beam')).toBe(beam)
  expect(beam.style.animationDuration).toBe('100ms')
  view.unmount()
  expect(cancel).toHaveBeenCalled()
  raf.mockRestore()
  cancel.mockRestore()
})
