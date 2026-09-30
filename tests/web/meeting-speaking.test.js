import { act, renderHook } from '@testing-library/react'
import useMeetingSpeaking from '@/hooks/useMeetingSpeaking'
import { createAudioAnalyser } from 'livekit-client'
jest.mock('livekit-client', () => ({ createAudioAnalyser: jest.fn() }))

test('quiet speech activates on the first sample and releases without a timer', () => {
  let level = 0.009
  let frame
  const cleanup = jest.fn().mockResolvedValue()
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1 })
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  createAudioAnalyser.mockReturnValue({ analyser: { fftSize: 512, getFloatTimeDomainData: data => data.fill(level) }, cleanup })
  const track = { mediaStreamTrack: {} }
  const { result, rerender, unmount } = renderHook(({ muted }) => useMeetingSpeaking(track, muted, false), { initialProps: { muted: false } })
  expect(result.current).toBe(true)
  level = 0.005
  act(() => frame())
  expect(result.current).toBe(true)
  level = 0
  act(() => frame())
  expect(result.current).toBe(false)
  rerender({ muted: true })
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(cancel).toHaveBeenCalled()
  unmount()
  raf.mockRestore()
  cancel.mockRestore()
})

test('SDK fallback works without an audio track, but never when muted', () => {
  const { result, rerender } = renderHook(({ muted }) => useMeetingSpeaking(null, muted, true), { initialProps: { muted: false } })
  expect(result.current).toBe(true)
  rerender({ muted: true })
  expect(result.current).toBe(false)
})
