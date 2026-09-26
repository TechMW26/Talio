import { prepareMiraAudioCapture, createMiraAudioCapture } from '@/lib/miraAudioCapture'

test('missing AudioWorklet falls back to silent, releasable capture', async () => {
  const node = { disconnect: jest.fn() }
  const context = { createScriptProcessor: jest.fn(() => node) }
  const mode = await prepareMiraAudioCapture(context)
  expect(mode).toBe(false)
  const onSamples = jest.fn()
  const capture = createMiraAudioCapture(context, mode, onSamples)
  const input = new Float32Array([.25, -.5]), output = new Float32Array([1, 1])
  node.onaudioprocess({ inputBuffer: { getChannelData: () => input }, outputBuffer: { getChannelData: () => output } })
  expect(onSamples).toHaveBeenCalledWith(input)
  expect(onSamples.mock.calls[0][0]).not.toBe(input)
  expect([...output]).toEqual([0, 0])
  capture.close()
  expect(node.onaudioprocess).toBeNull()
  expect(node.disconnect).toHaveBeenCalled()
})

test('failed worklet module falls back, but unsupported capture gives an actionable error', async () => {
  const original = global.AudioWorkletNode
  global.AudioWorkletNode = jest.fn()
  try {
    await expect(prepareMiraAudioCapture({ audioWorklet: { addModule: jest.fn().mockRejectedValue(new Error('blocked')) }, createScriptProcessor: jest.fn() })).resolves.toBe(false)
    await expect(prepareMiraAudioCapture({})).rejects.toThrow('Please update Talio')
  } finally { global.AudioWorkletNode = original }
})

test('supported worklet remains preferred and closes its port', async () => {
  const original = global.AudioWorkletNode
  const node = { port: { close: jest.fn() }, disconnect: jest.fn() }
  global.AudioWorkletNode = jest.fn(() => node)
  try {
    const context = { audioWorklet: { addModule: jest.fn().mockResolvedValue() } }
    expect(await prepareMiraAudioCapture(context)).toBe(true)
    const onSamples = jest.fn(), capture = createMiraAudioCapture(context, true, onSamples)
    node.port.onmessage({ data: new Float32Array([.2]) })
    expect(onSamples).toHaveBeenCalledTimes(1)
    capture.close()
    expect(node.port.onmessage).toBeNull()
    expect(node.port.close).toHaveBeenCalled()
  } finally { global.AudioWorkletNode = original }
})
