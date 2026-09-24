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

afterEach(() => { delete window.documentPictureInPicture; delete document.visibilityState; delete navigator.mediaSession })

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
  act(() => target.close())
})
