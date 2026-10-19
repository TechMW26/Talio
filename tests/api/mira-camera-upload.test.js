import { inspectMiraCamera, usableMiraCameraFrame } from '@/lib/miraCamera'
const originalFetch = global.fetch
let video, canvas, context, track, stream
beforeEach(() => {
  video = { play: jest.fn(async () => {}), pause: jest.fn(), videoWidth: 1920, videoHeight: 1080, readyState: 4 }
  context = { drawImage: jest.fn(), getImageData: jest.fn(() => ({ data: new Uint8ClampedArray([30, 40, 50, 255, 120, 130, 140, 255]) })) }
  track = { readyState: 'live', enabled: true, muted: false }
  stream = { getVideoTracks: () => [track] }
  canvas = { getContext: () => context, toBlob: callback => callback(new Blob(['frame'], { type: 'image/jpeg' })) }
  global.document = { createElement: name => name === 'video' ? video : canvas }
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, attachment: { text: 'A red pencil beside a drawing.' } }) }))
})
afterEach(() => { global.fetch = originalFetch; delete global.document })
test('captures one bounded image and uploads through the authenticated vision endpoint', async () => {
  const signal = new AbortController().signal
  const onCaptured = jest.fn(() => { expect(fetch).not.toHaveBeenCalled() })
  const result = await inspectMiraCamera(stream, { signal, token: 'test-only', onCaptured })
  expect(onCaptured).toHaveBeenCalledTimes(1)
  expect(onCaptured).toHaveBeenCalledWith({ capturedAt: result.capturedAt })
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
  await expect(inspectMiraCamera(stream, { token: 'test' })).rejects.toThrow('Vision unavailable')
  expect(video.srcObject).toBeNull()
})
test('rejects startup black, white and uniform buffers', () => {
  for (const light of [0, 255, 100]) expect(usableMiraCameraFrame(new Uint8ClampedArray([light, light, light, 255, light, light, light, 255]))).toBe(false)
})
test('waits for decoded warmup frames and retries blank frames before one upload', async () => {
  let frames = 0
  video.requestVideoFrameCallback = callback => { frames++; queueMicrotask(callback); return frames }
  video.cancelVideoFrameCallback = jest.fn()
  context.getImageData.mockReturnValueOnce({ data: new Uint8ClampedArray(32) })
  await inspectMiraCamera(stream, { token: 'test' })
  expect(frames).toBe(4)
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('camera closure while waiting for a decoded frame cancels without upload', async () => {
  video.requestVideoFrameCallback = jest.fn(() => 1)
  video.cancelVideoFrameCallback = jest.fn()
  const controller = new AbortController()
  const result = inspectMiraCamera(stream, { signal: controller.signal })
  controller.abort()
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1)
  expect(fetch).not.toHaveBeenCalled()
})
test('all-black frames hit the readiness deadline instead of being uploaded', async () => {
  const deadline = new AbortController()
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  let frames = 0
  video.requestVideoFrameCallback = callback => {
    frames++
    if (frames === 5) queueMicrotask(() => deadline.abort(new DOMException('Camera warmup timed out', 'TimeoutError')))
    else queueMicrotask(callback)
    return frames
  }
  video.cancelVideoFrameCallback = jest.fn()
  context.getImageData.mockReturnValue({ data: new Uint8ClampedArray(32) })
  try {
    await expect(inspectMiraCamera(stream, {})).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(video.srcObject).toBeNull()
  } finally { timeout.mockRestore() }
})
test('ended tracks never upload even if a decoded frame still exists', async () => {
  track.readyState = 'ended'
  await expect(inspectMiraCamera(stream, {})).rejects.toThrow('camera is off')
  expect(fetch).not.toHaveBeenCalled()
})
