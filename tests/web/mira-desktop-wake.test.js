const { revealMiraWindow } = require('../../desktop-app/src/miraWakeBridge')

function fixture(url = 'https://app.talio.in/dashboard') {
  const mainFrame = { url }
  const webContents = { mainFrame }
  const window = {
    webContents, isDestroyed: () => false, isMinimized: () => true,
    isVisible: () => false, isFocused: () => false,
    restore: jest.fn(), show: jest.fn(), focus: jest.fn(),
  }
  return { window, event: { sender: webContents, senderFrame: mainFrame } }
}

test('trusted dashboard wake restores the existing window without navigation', () => {
  const { window, event } = fixture()
  expect(revealMiraWindow(event, window, 'https://app.talio.in')).toEqual({ success: true })
  expect(window.restore).toHaveBeenCalledTimes(1)
  expect(window.show).toHaveBeenCalledTimes(1)
  expect(window.focus).toHaveBeenCalledTimes(1)
})

test.each(['https://evil.example/dashboard', 'https://app.talio.in/login', 'file:///dashboard', 'invalid'])('rejects untrusted source %s', url => {
  const { window, event } = fixture(url)
  expect(revealMiraWindow(event, window, 'https://app.talio.in').success).toBe(false)
  expect(window.show).not.toHaveBeenCalled()
})

test('rejects subframes, other renderers and destroyed windows', () => {
  const { window, event } = fixture()
  expect(revealMiraWindow({ ...event, sender: {} }, window, 'https://app.talio.in').success).toBe(false)
  expect(revealMiraWindow({ ...event, senderFrame: { url: event.senderFrame.url } }, window, 'https://app.talio.in').success).toBe(false)
  window.isDestroyed = () => true
  expect(revealMiraWindow(event, window, 'https://app.talio.in').success).toBe(false)
  expect(window.show).not.toHaveBeenCalled()
})
