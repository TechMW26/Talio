import { createRef, useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import NativePipSurface from '@/components/ui/NativePipSurface'

function fakeWindow() {
  const events = new EventTarget()
  const target = {
    document: document.implementation.createHTMLDocument('PiP'), closed: false,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    close: jest.fn(() => { target.closed = true; events.dispatchEvent(new Event('pagehide')) }),
  }
  return target
}

beforeEach(() => { jest.spyOn(document, 'hasFocus').mockReturnValue(true) })
afterEach(() => { delete window.documentPictureInPicture; delete window.electronAPI; delete document.visibilityState; delete navigator.mediaSession; jest.restoreAllMocks(); jest.useRealTimers() })

test('a background browser wake attempts PiP and explains blocked activation without losing the panel', async () => {
  jest.useFakeTimers()
  jest.spyOn(document, 'hasFocus').mockReturnValue(false)
  window.documentPictureInPicture = { requestWindow: jest.fn().mockRejectedValue(new DOMException('Requires activation', 'NotAllowedError')) }
  render(<NativePipSurface automatic>Listening after wake</NativePipSurface>)
  await act(async () => { jest.advanceTimersByTime(100) })
  expect(window.documentPictureInPicture.requestWindow).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Listening after wake')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('browser blocked the external window')
})

test('desktop blur opens a transparent external panel and focus restores the same live component', async () => {
  jest.useFakeTimers()
  window.electronAPI = { nativePip: true }
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  const focus = jest.spyOn(document, 'hasFocus').mockReturnValue(true)
  const target = fakeWindow()
  jest.spyOn(window, 'open').mockReturnValue(target)
  const onBackgroundChange = jest.fn()
  render(<NativePipSurface automatic onBackgroundChange={onBackgroundChange}>Desktop MIRA</NativePipSurface>)
  const element = screen.getByText('Desktop MIRA')
  focus.mockReturnValue(false)
  await act(async () => { window.dispatchEvent(new Event('blur')); jest.advanceTimersByTime(100) })
  expect(onBackgroundChange).toHaveBeenLastCalledWith(true)
  expect(target.document.body.contains(element)).toBe(true)
  expect(target.document.head.textContent).toContain('background:transparent!important')
  expect(target.document.head.textContent).not.toContain('border-radius:0!important')
  focus.mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.body.contains(element)).toBe(true)
  expect(onBackgroundChange).toHaveBeenLastCalledWith(false)
  expect(target.close).toHaveBeenCalledTimes(1)
})

test('desktop already minimized opens on mount and a quick refocus cancels pending opening', async () => {
  jest.useFakeTimers()
  window.electronAPI = { nativePip: true }
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  const focus = jest.spyOn(document, 'hasFocus').mockReturnValue(false)
  const target = fakeWindow()
  jest.spyOn(window, 'open').mockReturnValue(target)
  render(<NativePipSurface automatic>MIRA</NativePipSurface>)
  await act(async () => { jest.advanceTimersByTime(100) })
  expect(window.open).toHaveBeenCalledTimes(1)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  focus.mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('focus')))
  focus.mockReturnValue(false)
  act(() => window.dispatchEvent(new Event('blur')))
  focus.mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => { jest.advanceTimersByTime(100) })
  expect(window.open).toHaveBeenCalledTimes(1)
})

test('moves a stable portal without remounting and returns it on window close', async () => {
  const mounted = jest.fn()
  function Session() { useEffect(mounted, []); return <button>Live session</button> }
  const target = fakeWindow()
  window.documentPictureInPicture = { requestWindow: jest.fn().mockResolvedValue(target) }
  const ref = createRef()
  render(<NativePipSurface ref={ref}><Session /></NativePipSurface>)
  const button = screen.getByText('Live session')
  await act(async () => { await ref.current.open() })
  expect(target.document.body.contains(button)).toBe(true)
  expect(mounted).toHaveBeenCalledTimes(1)
  act(() => target.close())
  expect(document.body.contains(button)).toBe(true)
  expect(mounted).toHaveBeenCalledTimes(1)
})

test('shares one native window and restores each panel independently', async () => {
  const target = fakeWindow()
  const requestWindow = jest.fn().mockResolvedValue(target)
  window.documentPictureInPicture = { requestWindow }
  const meeting = createRef(), mira = createRef()
  render(<><NativePipSurface ref={meeting}>Meeting</NativePipSurface><NativePipSurface ref={mira}>MIRA</NativePipSurface></>)
  await act(async () => { await meeting.current.open(); await mira.current.open() })
  expect(requestWindow).toHaveBeenCalledTimes(1)
  expect(target.document.querySelectorAll('[data-native-pip-surface]')).toHaveLength(2)
  act(() => meeting.current.restore())
  expect(target.close).not.toHaveBeenCalled()
  expect(target.document.body.textContent).toContain('MIRA')
  act(() => mira.current.restore())
  expect(target.close).toHaveBeenCalledTimes(1)
})

test('unsupported browsers retain the usable inline panel and explain fallback', async () => {
  const ref = createRef()
  render(<NativePipSurface ref={ref}>Live captions</NativePipSurface>)
  await act(async () => { await ref.current.open() })
  expect(screen.getByText('Live captions')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('not supported')
})

test('disabling or unmounting returns/closes the native surface', async () => {
  const target = fakeWindow()
  window.documentPictureInPicture = { requestWindow: jest.fn().mockResolvedValue(target) }
  const ref = createRef()
  const view = render(<NativePipSurface ref={ref}>Session</NativePipSurface>)
  await act(async () => { await ref.current.open() })
  view.rerender(<NativePipSurface ref={ref} enabled={false}>Session</NativePipSurface>)
  expect(target.close).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Session')).toBeTruthy()
  view.unmount()
})

test('closing an inline panel does not reinsert its DOM and cancel the exit transition', () => {
  const ref = createRef()
  const view = render(<NativePipSurface ref={ref}>Inline panel</NativePipSurface>)
  const host = document.querySelector('[data-native-pip-surface]')
  const parent = host.parentNode
  const append = jest.spyOn(parent, 'append')
  view.rerender(<NativePipSurface ref={ref} enabled={false}>Inline panel</NativePipSurface>)
  act(() => ref.current.restore())
  expect(host.parentNode).toBe(parent)
  expect(append).not.toHaveBeenCalled()
  view.rerender(<NativePipSurface ref={ref} enabled>Inline panel</NativePipSurface>)
  act(() => ref.current.restore())
  expect(append).not.toHaveBeenCalled()
})

test('automatic PiP stays inline while visible, opens on browser activation, and returns on visibility', async () => {
  let handler
  Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: { setActionHandler: jest.fn((name, callback) => { handler = callback }) } })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  const target = fakeWindow()
  window.documentPictureInPicture = { requestWindow: jest.fn().mockResolvedValue(target) }
  const ref = createRef()
  render(<NativePipSurface ref={ref} automatic>Captions</NativePipSurface>)
  await act(async () => { await ref.current.open(); handler() })
  expect(window.documentPictureInPicture.requestWindow).not.toHaveBeenCalled()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  // Visibility alone never bypasses the browser's activation requirement.
  expect(window.documentPictureInPicture.requestWindow).not.toHaveBeenCalled()
  await act(async () => { handler(); await Promise.resolve() })
  expect(target.document.body.textContent).toContain('Captions')
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(screen.getByText('Captions')).toBeTruthy()
  expect(target.close).toHaveBeenCalledTimes(1)
})

test('initial native dimensions match the element rather than a fixed 480x640 window', async () => {
  const target = fakeWindow()
  window.documentPictureInPicture = { requestWindow: jest.fn().mockResolvedValue(target) }
  const ref = createRef()
  render(<NativePipSurface ref={ref}><div className="mira-workspace">Sized panel</div></NativePipSurface>)
  screen.getByText('Sized panel').getBoundingClientRect = () => ({ width: 340, height: 164 })
  await act(async () => { await ref.current.open() })
  expect(window.documentPictureInPicture.requestWindow).toHaveBeenCalledWith({ width: 340, height: 164 })
  expect(target.document.head.textContent).toContain('margin:0;padding:0')
  expect(target.document.head.textContent).toContain('border-radius:0!important')
  expect(target.document.head.textContent).toContain('.mira-workspace [data-ai-activity-beam]')
  act(() => target.close())
})
