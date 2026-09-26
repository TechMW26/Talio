const { createMiraDesktopScreenCapture } = require('../../desktop-app/src/miraDesktopScreen')

function harness(overrides = {}) {
  const image = {
    isEmpty: () => false,
    toJPEG: jest.fn(() => Buffer.from('jpeg-bytes')),
  }
  const contents = {
    mainFrame: { url: 'https://app.talio.in/dashboard/tasks' },
    getURL: () => 'https://app.talio.in/dashboard/tasks',
    isDestroyed: () => false,
  }
  const window = { webContents: contents, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const deps = {
    desktopCapturer: { getSources: jest.fn(async () => [{ display_id: 'display-1', thumbnail: image }]) },
    screen: { getCursorScreenPoint: () => ({ x: 10, y: 10 }), getDisplayNearestPoint: () => ({ id: 'display-1' }) },
    dialog: { showMessageBox: jest.fn(async () => ({ response: 1 })) },
    systemPreferences: { getMediaAccessStatus: () => 'granted' },
    platform: 'darwin',
    ...overrides,
  }
  return { capture: createMiraDesktopScreenCapture(deps), deps, event, window }
}

test('captures only the current authenticated Talio display after explicit consent', async () => {
  const { capture, deps, event, window } = harness()
  await expect(capture(event, window, 'https://app.talio.in')).resolves.toMatchObject({ success: true, mimeType: 'image/jpeg' })
  expect(deps.dialog.showMessageBox).toHaveBeenCalledTimes(1)
  expect(deps.desktopCapturer.getSources).toHaveBeenCalledWith(expect.objectContaining({ types: ['screen'] }))
})

test('does not capture or upload when the user cancels', async () => {
  const { capture, deps, event, window } = harness({ dialog: { showMessageBox: jest.fn(async () => ({ response: 0 })) } })
  await expect(capture(event, window, 'https://app.talio.in')).resolves.toMatchObject({ success: false, message: expect.stringContaining('cancelled') })
})

test('rejects untrusted renderer and non-dashboard URLs', async () => {
  const { capture, event, window } = harness()
  await expect(capture({ ...event, senderFrame: { url: 'https://evil.example/dashboard' } }, window, 'https://app.talio.in')).resolves.toMatchObject({ success: false })
  await expect(capture({ ...event, senderFrame: { url: 'https://app.talio.in/login' } }, window, 'https://app.talio.in')).resolves.toMatchObject({ success: false })
})

test('reuses desktop consent for successive frames and honors revocation', async () => {
  let approved = true
  const { capture, deps, event, window } = harness({ hasDesktopConsent: () => approved })
  await expect(capture(event, window, 'https://app.talio.in')).resolves.toMatchObject({ success: true })
  await expect(capture(event, window, 'https://app.talio.in')).resolves.toMatchObject({ success: true })
  expect(deps.dialog.showMessageBox).not.toHaveBeenCalled()
  approved = false
  deps.dialog.showMessageBox.mockResolvedValue({ response: 0 })
  await expect(capture(event, window, 'https://app.talio.in')).resolves.toMatchObject({ success: false })
  expect(deps.dialog.showMessageBox).toHaveBeenCalledTimes(1)
})

test('desktop consent does not bypass OS permission or renderer validation', async () => {
  const { capture, deps, event, window } = harness({ hasDesktopConsent: () => true, systemPreferences: { getMediaAccessStatus: () => 'denied' } })
  await expect(capture(event, window, 'https://app.talio.in')).resolves.toMatchObject({ success: false })
  await expect(capture({ ...event, sender: {} }, window, 'https://app.talio.in')).resolves.toMatchObject({ success: false })
  expect(deps.desktopCapturer.getSources).not.toHaveBeenCalled()
})
