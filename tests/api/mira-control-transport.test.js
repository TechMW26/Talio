const { EventEmitter } = require('events')
const { createControlTransport } = require('../../desktop-app/src/miraControlTransport')
function harness() {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter()
  child.stdin.write = jest.fn(); child.kill = jest.fn()
  const spawn = jest.fn(() => child)
  return { child, spawn, transport: createControlTransport('helper', ['--serve'], spawn) }
}
test('reuses one helper for sequential commands and decodes fragmented JSON', async () => {
  const { transport, child, spawn } = harness()
  for (let i = 0; i < 5; i++) {
    const result = transport.request({ type: 'status' })
    child.stdout.emit('data', '{"success":'); child.stdout.emit('data', 'true}\n')
    expect(await result).toEqual({ success: true })
  }
  expect(spawn).toHaveBeenCalledTimes(1)
  transport.stop(); expect(child.kill).toHaveBeenCalledTimes(1)
})
test('rejects concurrent inputs and never replays input after a crash', async () => {
  const { transport, child, spawn } = harness()
  const pending = transport.request({ type: 'click' })
  const assertion = expect(pending).rejects.toThrow('uncertain')
  await expect(transport.request({ type: 'click' })).rejects.toThrow('already running')
  child.emit('exit', 1); await assertion
  expect(child.stdin.write).toHaveBeenCalledTimes(1); expect(spawn).toHaveBeenCalledTimes(1)
})
test('preserves Hindi control labels split across UTF-8 pipe chunks', async () => {
  const { transport, child } = harness()
  const result = transport.request({ type: 'status' })
  const bytes = Buffer.from(JSON.stringify({ success: true, label: 'खोजें' }) + '\n')
  for (const byte of bytes) child.stdout.emit('data', Buffer.from([byte]))
  expect(await result).toEqual({ success: true, label: 'खोजें' })
  transport.stop()
})
test('invalid, oversized and unsolicited replies fail closed', async () => {
  for (const data of ['not json\n', 'x'.repeat(100001), '{"success":true}\n{"success":true}\n']) {
    const { transport, child } = harness(); const result = transport.request({ type: 'click' })
    const assertion = expect(result).rejects.toThrow('uncertain')
    child.stdout.emit('data', data); await assertion
    expect(child.kill).toHaveBeenCalledTimes(1)
  }
})
test('timeout and explicit cancellation reject in-flight input without replay', async () => {
  jest.useFakeTimers()
  try {
    const { transport, child } = harness()
    const assertion = expect(transport.request({ type: 'click' })).rejects.toThrow('uncertain')
    await jest.advanceTimersByTimeAsync(12000); await assertion
    expect(child.stdin.write).toHaveBeenCalledTimes(1)
  } finally { jest.useRealTimers() }
})
test('only capture replies have a larger bounded image budget', async () => {
  const { transport, child } = harness()
  const pending = transport.request({ type: 'capture', displayId: 1 })
  const image = 'a'.repeat(150000)
  child.stdout.emit('data', JSON.stringify({ success: true, image }) + '\n')
  expect((await pending).image).toHaveLength(image.length)
  const oversized = transport.request({ type: 'capture', displayId: 1 })
  const rejected = expect(oversized).rejects.toThrow('uncertain')
  child.stdout.emit('data', 'a'.repeat(2000001))
  await rejected
  expect(child.kill).toHaveBeenCalledTimes(1)
})
