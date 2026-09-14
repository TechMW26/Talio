import { act, renderHook } from '@testing-library/react'
import useLocationCapture, { getAttendanceLocationOptions } from '@/hooks/useLocationCapture'

beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: jest.fn(), clearWatch: jest.fn() } })
})

test('optional location uses a recent fix and a bounded wait without weakening strict policy', () => {
  expect(getAttendanceLocationOptions({ enabled: false })).toEqual({ maxAccuracyMeters: 150, requireAccurate: false, maximumAge: 10000, timeout: 5000 })
  expect(getAttendanceLocationOptions({ enabled: true, strictMode: true, maxAccuracyMeters: 40 })).toEqual({ maxAccuracyMeters: 40, requireAccurate: true, maximumAge: 0, timeout: 15000 })
})

test('passes fresh-location requirements to the browser and rejects imprecise strict fixes', async () => {
  navigator.geolocation.getCurrentPosition.mockImplementation(success => success({ coords: { latitude: 20, longitude: 70, accuracy: 300 }, timestamp: Date.now() }))
  const { result } = renderHook(() => useLocationCapture())
  await act(async () => {
    await expect(result.current.captureLocation(getAttendanceLocationOptions({ enabled: true, strictMode: true, maxAccuracyMeters: 40 }))).rejects.toMatchObject({ name: 'LocationError' })
  })
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  expect(result.current.location).toBeNull()
})

test('optional capture accepts zero coordinates and passes the short freshness budget', async () => {
  navigator.geolocation.getCurrentPosition.mockImplementation(success => success({ coords: { latitude: 0, longitude: 0, accuracy: 20 }, timestamp: Date.now() }))
  const { result } = renderHook(() => useLocationCapture())
  await act(async () => { await result.current.captureLocation(getAttendanceLocationOptions(null)) })
  expect(result.current.location).toMatchObject({ latitude: 0, longitude: 0, accuracy: 20 })
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 })
})
