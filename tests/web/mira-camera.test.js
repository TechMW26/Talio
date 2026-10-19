import React from 'react'
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react'
import useMiraCamera from '@/hooks/useMiraCamera'
import MiraCameraNotch from '@/components/ui/MiraCameraNotch'
import { inspectMiraCamera } from '@/lib/miraCamera'
jest.mock('@/lib/miraCamera', () => ({ inspectMiraCamera: jest.fn() }))
jest.mock('@/components/ui/AIActivityBeam', () => function Beam() { return <div data-testid="capture-beam" /> })
let stopTrack, media, getUserMedia
beforeEach(() => {
  stopTrack = jest.fn()
  const track = { stop: stopTrack }
  media = { getTracks: () => [track], getVideoTracks: () => [track] }
  getUserMedia = jest.fn(async () => media)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  inspectMiraCamera.mockReset().mockResolvedValue({ success: true, untrustedVisualContext: 'A drawing.' })
  HTMLMediaElement.prototype.play = jest.fn(async () => {})
  HTMLMediaElement.prototype.pause = jest.fn()
})
test('AI inspection reuses setup permission without an extra in-app confirmation', async () => {
  const { result, unmount } = renderHook(() => useMiraCamera(true))
  let answer
  act(() => { answer = result.current.inspect() })
  expect(result.current.state).toBe('starting')
  await act(async () => { await answer })
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
  expect(inspectMiraCamera).toHaveBeenCalledTimes(1)
  expect(result.current.state).toBe('active')
  await act(async () => { await result.current.inspect() })
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  expect(inspectMiraCamera).toHaveBeenCalledTimes(2)
  unmount()
  expect(stopTrack).toHaveBeenCalledTimes(1)
})
test('closing while camera starts prevents snapshot capture', async () => {
  const { result } = renderHook(() => useMiraCamera(true))
  let answer
  act(() => { answer = result.current.inspect() })
  await act(async () => { result.current.stop(); await expect(answer).resolves.toMatchObject({ success: false }) })
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  expect(inspectMiraCamera).not.toHaveBeenCalled()
})
test('overlapping inspections cannot acquire or upload a second snapshot', async () => {
  let resolve
  inspectMiraCamera.mockImplementation(() => new Promise(done => { resolve = done }))
  const { result, unmount } = renderHook(() => useMiraCamera(true))
  let first
  await act(async () => { first = result.current.inspect(); await Promise.resolve() })
  await act(async () => { await expect(result.current.inspect()).resolves.toMatchObject({ success: false, busy: true }) })
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  expect(inspectMiraCamera).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ success: true }); await first })
  unmount()
})
test('late OS permission resolution after close releases the device without uploading', async () => {
  let resolve
  getUserMedia.mockImplementation(() => new Promise(done => { resolve = done }))
  const { result, rerender } = renderHook(({ open }) => useMiraCamera(open), { initialProps: { open: true } })
  let answer
  act(() => { answer = result.current.inspect().catch(error => error) })
  rerender({ open: false })
  await act(async () => { resolve(media); await answer })
  expect(stopTrack).toHaveBeenCalledTimes(1)
  expect(inspectMiraCamera).not.toHaveBeenCalled()
})
test('camera preview joins the top edge with bottom-only curves and no status or controls', () => {
  const camera = { state: 'starting', stop: jest.fn() }
  render(<MiraCameraNotch camera={camera} />)
  expect(screen.getByRole('region', { name: 'Mira camera' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Enable camera' })).not.toBeInTheDocument()
  expect(screen.getByRole('region')).toHaveStyle({ background: '#000', border: '0px', boxShadow: 'none' })
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByText('Camera on')).not.toBeInTheDocument()
  expect(screen.getByRole('region')).toHaveStyle({ top: '0px', borderRadius: '0 0 14px 14px', paddingTop: '0px' })
  expect(screen.getByLabelText('Your camera preview')).toHaveStyle({ borderRadius: '0 0 9px 9px' })
})
test('camera times out and stops every track instead of remaining on unattended', async () => {
  jest.useFakeTimers()
  try {
    const { result, unmount } = renderHook(() => useMiraCamera(true))
    let answer
    act(() => { answer = result.current.inspect() })
    await act(async () => { await answer })
    act(() => jest.advanceTimersByTime(120000))
    expect(stopTrack).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('off')
    unmount()
  } finally { jest.useRealTimers() }
})
test('preview follows decoded camera dimensions and removes the capture beam immediately', () => {
  const camera = { state: 'active', stop: jest.fn(), capturing: true }
  const { rerender } = render(<MiraCameraNotch camera={camera} />)
  const video = screen.getByLabelText('Your camera preview')
  Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 } })
  fireEvent.loadedMetadata(video)
  expect(video.style.aspectRatio).toBe(String(4 / 3))
  expect(video).toHaveStyle({ objectFit: 'contain' })
  expect(screen.getByTestId('capture-beam')).toBeInTheDocument()
  rerender(<MiraCameraNotch camera={{ ...camera, capturing: false }} />)
  expect(screen.queryByTestId('capture-beam')).not.toBeInTheDocument()
})
test('native portal announces content readiness and aspect ratio without waiting for a window paint event', () => {
  const popup = { document: document.implementation.createHTMLDocument('camera'), addEventListener: jest.fn(), removeEventListener: jest.fn(), close: jest.fn() }
  const open = jest.spyOn(window, 'open').mockReturnValue(popup)
  window.electronAPI = { resizeMiraCamera: jest.fn() }
  try {
    const stream = { getVideoTracks: () => [{ getSettings: () => ({ width: 640, height: 480 }) }] }
    const { unmount } = render(<MiraCameraNotch camera={{ state: 'active', stream, stop: jest.fn() }} />)
    expect(popup.document.querySelector('video')).not.toBeNull()
    expect(window.electronAPI.resizeMiraCamera).toHaveBeenLastCalledWith({ aspectRatio: 4 / 3 })
    unmount()
    expect(popup.close).toHaveBeenCalled()
  } finally { open.mockRestore(); delete window.electronAPI }
})
test('capture feedback ends before the vision provider responds', async () => {
  let complete, captured
  inspectMiraCamera.mockImplementation((media, options) => { captured = options.onCaptured; return new Promise(resolve => { complete = resolve }) })
  const { result } = renderHook(() => useMiraCamera(true))
  let request
  await act(async () => { request = result.current.inspect(); await Promise.resolve() })
  expect(result.current.capturing).toBe(true)
  act(() => captured())
  expect(result.current.capturing).toBe(false)
  expect(result.current.state).toBe('active')
  await act(async () => { complete({ success: true }); await request })
})
test('closing clears current visual context and discards late provider results', async () => {
  let resolve
  inspectMiraCamera.mockImplementation(() => new Promise(done => { resolve = done }))
  const { result } = renderHook(() => useMiraCamera(true))
  let answer
  await act(async () => { answer = result.current.inspect(); await Promise.resolve() })
  expect(result.current.getContext().state).toBe('active')
  act(() => result.current.stop())
  expect(result.current.getContext()).toEqual({ state: 'off', capturedAt: null })
  await act(async () => { resolve({ success: true, capturedAt: new Date().toISOString(), untrustedVisualContext: 'Old view' }); await expect(answer).resolves.toMatchObject({ success: false }) })
  expect(result.current.getContext().capturedAt).toBeNull()
})
test('OS refusal reports error and never sends an image', async () => {
  getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  const { result } = renderHook(() => useMiraCamera(true))
  await act(async () => { await expect(result.current.inspect()).resolves.toMatchObject({ success: false }) })
  expect(result.current.state).toBe('error')
  expect(inspectMiraCamera).not.toHaveBeenCalled()
})
