import { partialMiraMessage, readMiraEvents } from '@/lib/miraStream'
import { TextEncoder, TextDecoder } from 'util'
import { ReadableStream } from 'stream/web'

global.TextDecoder = TextDecoder

test('finishes on the complete event even if the connection stays open', async () => {
  const cancel = jest.fn()
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"type":"complete"}\n\n'))
  }, cancel })
  const events = []
  await readMiraEvents(body, event => events.push(event))
  expect(events).toEqual([{ type: 'complete' }])
  expect(cancel).toHaveBeenCalledTimes(1)
})

test('extracts only the leading message without exposing action payloads', () => {
  expect(partialMiraMessage('{"message":"Hello')).toBe('Hello')
  expect(partialMiraMessage('{"message":"Hello","action":{"type":"navigate"}}')).toBe('Hello')
  expect(partialMiraMessage('{"action":{"message":"unsafe"}}')).toBe('')
})
test('handles escaped quotes, line breaks and split unicode escapes', () => {
  expect(partialMiraMessage('{"message":"Say \\"hi\\"\\nNext')).toBe('Say "hi"\nNext')
  expect(partialMiraMessage('{"message":"\\u09')).toBe('')
  expect(partialMiraMessage('{"message":"\\u0928')).toBe('न')
})
test('parses fragmented UTF-8 SSE, CRLF and final unterminated records', async () => {
  const bytes = new TextEncoder().encode('data: {"message":"नमस्ते"}\r\n\r\ndata: {"type":"complete"}')
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } })
  const events = []
  await readMiraEvents(body, event => events.push(event))
  expect(events).toEqual([{ message: 'नमस्ते' }, { type: 'complete' }])
})
