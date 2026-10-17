import { inspectMiraCamera } from '@/lib/miraCamera'
const originalFetch = global.fetch
let video, canvas, context
beforeEach(() => {
  video = { play: jest.fn(async () => {}), pause: jest.fn(), videoWidth: 1920, videoHeight: 1080, readyState: 4 }
  context = { drawImage: jest.fn() }
  canvas = { getContext: () => context, toBlob: callback => callback(new Blob(['frame'], { type: 'image/jpeg' })) }
  global.document = { createElement: name => name === 'video' ? video : canvas }
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, attachment: { text: 'A red pencil beside a drawing.' } }) }))
})
afterEach(() => { global.fetch = originalFetch; delete global.document })
test('captures one bounded image and uploads through the authenticated vision endpoint', async () => {
  const signal = new AbortController().signal
  const result = await inspectMiraCamera({}, { signal, token: 'test-only' })
  expect(result).toMatchObject({ success: true, untrustedVisualContext: 'A red pencil beside a drawing.' })
  expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe('/api/ai/mira-attachments')
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-only')
  expect(fetch.mock.calls[0][1].body.get('file').name).toBe('camera-frame.jpg')
  expect(canvas.width).toBe(0)
  expect(video.srcObject).toBeNull()
  expect(video.pause).toHaveBeenCalledTimes(1)
})
test('cancellation before capture never uploads and provider rejection is not false success', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(inspectMiraCamera({}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Vision unavailable' }) })
  await expect(inspectMiraCamera({}, { token: 'test' })).rejects.toThrow('Vision unavailable')
  expect(video.srcObject).toBeNull()
})
