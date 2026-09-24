const { captureMiraAppSnapshot } = require('../../desktop-app/src/miraAppSnapshot')
test('captures only the authenticated Talio main renderer', async () => {
  const image = { isEmpty: () => false, getSize: () => ({ width: 1000 }), toJPEG: () => Buffer.from('image') }
  const contents = { mainFrame: { url: 'https://app.talio.in/dashboard/projects' }, getURL: () => 'https://app.talio.in/dashboard/projects', capturePage: jest.fn(async () => image), isDestroyed: () => false }
  const window = { isDestroyed: () => false, webContents: contents }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  expect(await captureMiraAppSnapshot(event, window, 'https://app.talio.in')).toMatchObject({ mimeType: 'image/jpeg', page: '/dashboard/projects' })
  expect(await captureMiraAppSnapshot({ ...event, senderFrame: { url: contents.mainFrame.url } }, window, 'https://app.talio.in')).toBeNull()
  contents.mainFrame.url = 'https://evil.example/dashboard'
  expect(await captureMiraAppSnapshot(event, window, 'https://app.talio.in')).toBeNull()
  expect(contents.capturePage).toHaveBeenCalledTimes(1)
})
