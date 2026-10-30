import { act, render, screen, fireEvent } from '@testing-library/react'
import { createRef, StrictMode, useState } from 'react'
import { Skeleton, LoadingReveal } from '@/components/ui/AsciiLoading'
import LoadingRevealCoordinator from '@/components/ui/LoadingRevealCoordinator'
import Modal from '@/components/ui/Modal'
import { createAsciiReveal } from 'ascii-reveal'
import { fernlyDialogMotion } from '@/lib/client/fernlyMotion'
import fs from 'fs'

jest.mock('ascii-reveal', () => ({
  ...jest.requireActual('ascii-reveal'),
  createAsciiReveal: jest.fn(),
}))

let frames, reduce, controllers
beforeEach(() => {
  frames = new Map(); reduce = false; controllers = []
  window.matchMedia = jest.fn(() => ({ matches: reduce, addEventListener: jest.fn(), removeEventListener: jest.fn() }))
  let id = 0
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: text => ({ width: String(text).length * 6 }),
    clearRect: jest.fn(), setTransform: jest.fn(), drawImage: jest.fn(),
    fillText: jest.fn(), save: jest.fn(), restore: jest.fn(),
    beginPath: jest.fn(), rect: jest.fn(), clip: jest.fn(),
  })
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frames.set(++id, fn); return id })
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => frames.delete(key))
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 })
  createAsciiReveal.mockReset().mockImplementation(() => {
    const controller = { reveal: jest.fn(() => Promise.resolve()), destroy: jest.fn() }
    controllers.push(controller)
    return controller
  })
})
afterEach(() => jest.restoreAllMocks())
async function flush() {
  await act(async () => {
    const callbacks = [...frames.values()]; frames.clear()
    callbacks.forEach(fn => fn())
    await Promise.resolve()
  })
}
function Fixture({ loading, extra = false }) {
  return <><LoadingRevealCoordinator /><section data-testid="surface">
    <input aria-label="Draft" defaultValue="Keep this" />
    {loading ? <div><Skeleton className="h-4 w-32" /><Skeleton className="h-20 w-full" /></div> : <h2>Ready</h2>}
    {extra && <Skeleton className="h-4" />}
  </section></>
}

test('dither preserves supplied geometry and enables the shared shimmer by default', () => {
  const ref = createRef()
  const { container } = render(<Skeleton ref={ref} className="h-10 w-24 rounded-lg" style={{ maxWidth: 96 }} />)
  expect(ref.current).toHaveClass('h-10', 'w-24')
  expect(ref.current).toHaveStyle({ maxWidth: '96px' })
  expect(container.querySelector('.ars-dither')).not.toBeNull()
  expect(container.querySelector('[data-ars-animate]')).not.toBeNull()
  expect(container.querySelector('canvas')).not.toBeNull()
  expect(ref.current).toHaveAttribute('aria-busy', 'true')
})
test('disableAnimation keeps the static dither and can be toggled without changing layout', () => {
  const { container, rerender } = render(<Skeleton disableAnimation className="h-10 w-24" />)
  const root = container.firstChild
  expect(container.querySelector('.ars-dither')).not.toBeNull()
  expect(container.querySelector('[data-ars-animate]')).toBeNull()
  expect(container.querySelector('canvas')).toBeNull()
  rerender(<Skeleton className="h-10 w-24" />)
  expect(container.firstChild).toBe(root)
  expect(container.querySelector('canvas')).not.toBeNull()
  rerender(<Skeleton disableAnimation className="h-10 w-24" />)
  expect(container.querySelector('canvas')).toBeNull()
})
test('reduced-motion preference keeps the skeleton static', () => {
  reduce = true
  const { container } = render(<Skeleton />)
  expect(container.querySelector('.ars-dither')).not.toBeNull()
  expect(container.querySelector('canvas')).toBeNull()
})
test('isLoaded keeps the same child DOM and removes placeholders', () => {
  const { rerender, container } = render(<Skeleton><input aria-label="Name" defaultValue="Ada" /></Skeleton>)
  const input = container.querySelector('input')
  fireEvent.change(input, { target: { value: 'New name' } })
  rerender(<Skeleton isLoaded><input aria-label="Name" defaultValue="Ada" /></Skeleton>)
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input.value).toBe('New name')
  expect(container.querySelector('[data-ascii-skeleton]')).toBeNull()
  expect(container.querySelector('canvas')).toBeNull()
})
test('loading completion batches sibling skeletons into one terminal reveal', async () => {
  const { rerender } = render(<Fixture loading />)
  const draft = screen.getByRole('textbox')
  fireEvent.change(draft, { target: { value: 'Unsaved draft' } })
  rerender(<Fixture loading={false} />)
  await flush()
  expect(createAsciiReveal).toHaveBeenCalledTimes(1)
  expect(createAsciiReveal).toHaveBeenCalledWith(screen.getByTestId('surface'), expect.objectContaining({ preset: 'terminal', fallback: true }))
  expect(screen.getByRole('textbox')).toBe(draft)
  expect(draft.value).toBe('Unsaved draft')
  expect(controllers[0].destroy).toHaveBeenCalled()
})
test('still-loading sections, cached content and strict-mode cleanup do not reveal prematurely', async () => {
  const { rerender } = render(<StrictMode><Fixture loading /></StrictMode>)
  await flush()
  expect(createAsciiReveal).not.toHaveBeenCalled()
  rerender(<StrictMode><Fixture loading={false} extra /></StrictMode>)
  await flush()
  expect(createAsciiReveal).not.toHaveBeenCalled()
})
test('reduced motion shows ready content without starting the effect', async () => {
  reduce = true
  const { rerender } = render(<Fixture loading />)
  rerender(<Fixture loading={false} />)
  await flush()
  expect(screen.getByText('Ready')).toBeVisible()
  expect(createAsciiReveal).not.toHaveBeenCalled()
})
test('route unmount cancels queued effects', async () => {
  const { unmount } = render(<Fixture loading />)
  unmount(); await flush()
  expect(createAsciiReveal).not.toHaveBeenCalled()
})
test('decorative renderer failure cannot break the completed content', async () => {
  createAsciiReveal.mockImplementation(() => { throw new Error('No canvas') })
  const { rerender } = render(<Fixture loading />)
  rerender(<Fixture loading={false} />)
  await flush()
  expect(screen.getByText('Ready')).toBeVisible()
})
test('custom popup Escape and backdrop dismissal still work', () => {
  const close = jest.fn()
  render(<Modal isOpen onClose={close} title="Details"><button>Action</button></Modal>)
  fireEvent.click(screen.getByText('Action'))
  expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalledTimes(1)
  fireEvent.click(document.querySelector('.modal-overlay'))
  expect(close).toHaveBeenCalledTimes(2)
})
test('popup motion is short, scale-only, and backdrop keyframes do not animate blur', () => {
  expect(fernlyDialogMotion.variants.enter.transition.duration).toBeLessThanOrEqual(.18)
  expect(fernlyDialogMotion.variants.exit.y).toBe(0)
  const css = fs.readFileSync('app/globals.css', 'utf8')
  const postcss = require('postcss')
  postcss.parse(css).walkAtRules('keyframes', rule => {
    if (/overlay-blur/.test(rule.params)) expect(rule.toString()).not.toContain('backdrop-filter')
  })
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
})
