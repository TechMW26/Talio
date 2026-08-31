import { act, render, waitFor } from '@testing-library/react'
import LocationGlobe from '@/components/dashboard/LocationGlobe'

const mockControlListeners = {}
const mockControls = {
  addEventListener: jest.fn((event, handler) => { mockControlListeners[event] = handler }),
  removeEventListener: jest.fn((event) => { delete mockControlListeners[event] }),
}
const mockGlobe = {
  controls: jest.fn(() => mockControls),
  pointOfView: jest.fn(),
  onGlobeReady: jest.fn().mockReturnThis(),
  width: jest.fn().mockReturnThis(),
  height: jest.fn().mockReturnThis(),
  _destructor: jest.fn(),
}

for (const method of [
  'globeImageUrl',
  'bumpImageUrl',
  'backgroundColor',
  'showAtmosphere',
  'atmosphereColor',
  'atmosphereAltitude',
  'showGraticules',
  'pointsData',
  'pointLat',
  'pointLng',
  'pointAltitude',
  'pointRadius',
  'pointColor',
  'ringsData',
  'ringLat',
  'ringLng',
  'ringColor',
  'ringMaxRadius',
  'ringPropagationSpeed',
  'ringRepeatPeriod',
]) {
  mockGlobe[method] = jest.fn().mockReturnValue(mockGlobe)
}

jest.mock('globe.gl', () => ({
  __esModule: true,
  default: jest.fn(() => jest.fn(() => mockGlobe)),
}))

class MockResizeObserver {
  observe = jest.fn()
  disconnect = jest.fn()
}

describe('LocationGlobe manual navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.keys(mockControlListeners).forEach((event) => delete mockControlListeners[event])
    window.WebGLRenderingContext = function WebGLRenderingContext() {}
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({})
    global.ResizeObserver = MockResizeObserver
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('returns to the saved location two seconds after interaction stops', async () => {
    const { unmount } = render(
      <LocationGlobe lat={23.2599} lon={77.4126} isDarkMode={true} />
    )

    await waitFor(() => expect(mockControls.addEventListener).toHaveBeenCalledTimes(2))
    expect(mockControlListeners.start).toEqual(expect.any(Function))
    expect(mockControlListeners.end).toEqual(expect.any(Function))

    jest.useFakeTimers()
    act(() => mockControlListeners.end())
    act(() => jest.advanceTimersByTime(1999))
    expect(mockGlobe.pointOfView).toHaveBeenCalledTimes(1)

    act(() => jest.advanceTimersByTime(1))
    expect(mockGlobe.pointOfView).toHaveBeenLastCalledWith(
      { lat: 23.2599, lng: 77.4126, altitude: 0.72 },
      900
    )

    act(() => mockControlListeners.end())
    act(() => jest.advanceTimersByTime(1000))
    act(() => mockControlListeners.start())
    act(() => jest.advanceTimersByTime(2000))
    expect(mockGlobe.pointOfView).toHaveBeenCalledTimes(2)

    unmount()
    expect(mockControls.removeEventListener).toHaveBeenCalledWith('start', expect.any(Function))
    expect(mockControls.removeEventListener).toHaveBeenCalledWith('end', expect.any(Function))
  })
})
