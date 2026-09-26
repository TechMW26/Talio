import { SCREENSHOT_CAPTURE_INTERVAL_MS, isEarlySessionCapture, getNextAllowedCaptureTime } from '@/lib/productivitySessionRules'
import { GET, POST } from '@/app/api/settings/screenshot-interval/route'
import { getAuthAndModels } from '@/lib/auth'
jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
jest.mock('electron', () => ({ screen: {} }), { virtual: true })
jest.mock('node-fetch', () => jest.fn())
jest.mock('../../desktop-app/src/logger', () => ({ log: jest.fn() }))
jest.mock('../../desktop-app/src/offlineQueue', () => ({ initialize: jest.fn(), reset: jest.fn() }))
const service = require('../../desktop-app/src/screenshotService')

test('server policy requires exactly four minutes between scheduled captures', () => {
  const date = new Date('2026-09-26T08:00:00Z')
  expect(SCREENSHOT_CAPTURE_INTERVAL_MS).toBe(240000)
  expect(isEarlySessionCapture(date, new Date(+date + 239999))).toBe(true)
  expect(isEarlySessionCapture(date, new Date(+date + 240000))).toBe(false)
  expect(+getNextAllowedCaptureTime(date) - date).toBe(240000)
})

test('old saved per-user settings cannot override the fixed policy', async () => {
  const update = jest.fn()
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'u', role: 'admin' }, models: { User: { findById: () => ({ select: async () => ({ settings: { screenshotInterval: 30 } }) }), findByIdAndUpdate: update } } })
  expect((await (await GET({})).json()).interval).toBe(4)
  expect((await POST({ json: async () => ({ interval: 3 }) })).status).toBe(400)
  expect(update).not.toHaveBeenCalled()
  expect((await POST({ json: async () => ({ interval: 4 }) })).status).toBe(200)
})

test('desktop timer fires every four minutes, not three', () => {
  jest.useFakeTimers()
  const capture = jest.spyOn(service, 'captureScreen').mockResolvedValue(null)
  try {
    service.userRole = 'employee'; service.isClockedIn = true
    service.start()
    expect(capture).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(60000)
    service.start()
    jest.advanceTimersByTime(179999)
    expect(capture).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    expect(capture).toHaveBeenCalledTimes(2)
  } finally { service.stop(); capture.mockRestore(); jest.useRealTimers() }
})

test('restarts cannot capture early and existing clock-in and permission guards remain active', async () => {
  jest.useFakeTimers()
  service.userRole = 'employee'; service.isClockedIn = true; service.isCapturing = true
  service.lastScheduledCaptureAt = null
  service.getDesktopSources = jest.fn().mockResolvedValue([])
  const size = jest.spyOn(service, 'getOptimalSize').mockReturnValue({ width: 100, height: 100 })
  service.checkPermission = () => 'granted'
  try {
    await service.captureScreen('session_start')
    await service.captureScreen('session_start')
    expect(service.getDesktopSources).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(240000)
    await service.captureScreen('automatic')
    expect(service.getDesktopSources).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(240000)
    service.checkPermission = () => 'denied'
    await service.captureScreen('automatic')
    service.isClockedIn = false
    await service.captureScreen('session_start')
    expect(service.getDesktopSources).toHaveBeenCalledTimes(2)
  } finally { service.stop(); size.mockRestore(); jest.useRealTimers() }
})
