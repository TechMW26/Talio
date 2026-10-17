import React from 'react'
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react'
import useMiraCamera from '@/hooks/useMiraCamera'
import MiraCameraNotch from '@/components/ui/MiraCameraNotch'
import { inspectMiraCamera } from '@/lib/miraCamera'
jest.mock('@/lib/miraCamera', () => ({ inspectMiraCamera: jest.fn() }))
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
test('AI inspection requests visible consent; only consent starts camera and one-shot vision', async () => {
  const { result, unmount } = renderHook(() => useMiraCamera(true))
  let answer
  act(() => { answer = result.current.inspect() })
  expect(result.current.state).toBe('consent')
  expect(getUserMedia).not.toHaveBeenCalled()
  await act(async () => { await result.current.allow(); await answer })
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }))
  expect(inspectMiraCamera).toHaveBeenCalledTimes(1)
  expect(result.current.state).toBe('active')
  await act(async () => { await result.current.inspect() })
  expect(getUserMedia).toHaveBeenCalledTimes(1)
  expect(inspectMiraCamera).toHaveBeenCalledTimes(2)
  unmount()
  expect(stopTrack).toHaveBeenCalledTimes(1)
})
test('declining camera never captures a frame or opens the device', async () => {
  const { result } = renderHook(() => useMiraCamera(true))
  let answer
  act(() => { answer = result.current.inspect() })
  await act(async () => { result.current.stop(); await expect(answer).resolves.toMatchObject({ success: false }) })
  expect(getUserMedia).not.toHaveBeenCalled()
  expect(inspectMiraCamera).not.toHaveBeenCalled()
})
test('late OS permission resolution after close releases the device without uploading', async () => {
  let resolve
  getUserMedia.mockImplementation(() => new Promise(done => { resolve = done }))
  const { result, rerender } = renderHook(({ open }) => useMiraCamera(open), { initialProps: { open: true } })
  let answer, permission
  act(() => { answer = result.current.inspect().catch(error => error); permission = result.current.allow() })
  rerender({ open: false })
  await act(async () => { resolve(media); await permission; await answer })
  expect(stopTrack).toHaveBeenCalledTimes(1)
  expect(inspectMiraCamera).not.toHaveBeenCalled()
})
test('camera preview shows consent and a usable close control without a transcript', () => {
  const camera = { state: 'consent', allow: jest.fn(), stop: jest.fn() }
  render(<MiraCameraNotch camera={camera} />)
  expect(screen.getByRole('region', { name: 'Mira camera' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Enable camera' }))
  expect(camera.allow).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Close camera' }))
  expect(camera.stop).toHaveBeenCalledTimes(1)
})
test('camera times out and stops every track instead of remaining on unattended', async () => {
  jest.useFakeTimers()
  try {
    const { result, unmount } = renderHook(() => useMiraCamera(true))
    let answer
    act(() => { answer = result.current.inspect() })
    await act(async () => { await result.current.allow(); await answer })
    act(() => jest.advanceTimersByTime(120000))
    expect(stopTrack).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('off')
    unmount()
  } finally { jest.useRealTimers() }
})
