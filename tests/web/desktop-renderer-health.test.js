/** @jest-environment jsdom */

const {
  inspectRendererHealth,
  resolveAppNavigationUrl,
} = require('../../desktop-app/src/rendererHealth')

describe('desktop meeting renderer recovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="__next"></div>'
    window.getComputedStyle = jest.fn(() => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }))
  })

  test('detects a hydrated root with no visible UI as blank', () => {
    document.getElementById('__next').innerHTML = '<div>hidden application markup that is long enough to look hydrated</div>'

    expect(inspectRendererHealth()).toMatchObject({
      isBlank: true,
      reason: 'no-visible-ui',
      rootHasContent: true,
    })
  })

  test('accepts the meeting loading state as healthy visible UI', () => {
    document.body.innerHTML = '<div id="__next"><div role="status">Loading Talio Meet…</div></div>'
    const status = document.querySelector('[role="status"]')
    status.getBoundingClientRect = () => ({ width: 240, height: 80 })
    document.getElementById('__next').getBoundingClientRect = () => ({ width: 1280, height: 800 })

    expect(inspectRendererHealth().isBlank).toBe(false)
  })

  test('preserves same-origin meeting URLs and rejects external recovery URLs', () => {
    const origin = 'https://app.talio.in'
    const roomUrl = `${origin}/dashboard/meetings/room/room-123`

    expect(resolveAppNavigationUrl(origin, origin, roomUrl)).toBe(roomUrl)
    expect(resolveAppNavigationUrl(origin, origin, 'https://example.com/meeting')).toBe(origin)
  })
})
