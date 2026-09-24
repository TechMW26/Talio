import { splitMiraSpeech } from '@/lib/miraSpeechChunks'
import { sanitizeMiraClientContext } from '@/lib/miraClientContext'

test('speech has a short first chunk, bounded later chunks, and no lost text', () => {
  const text = ('आज आपका दिन अच्छा हो। Your next meeting is at ten. ').repeat(20).trim()
  const chunks = splitMiraSpeech(text)
  expect(chunks[0].length).toBeLessThanOrEqual(120)
  expect(chunks.every(c => c.length <= 280 && c.length > 0)).toBe(true)
  expect(chunks.join(' ')).toBe(text)
})
test('client context rejects malicious paths and stale or invalid location', () => {
  const context = sanitizeMiraClientContext({ page: '/dashboard?token=secret', timezone: 'bad-zone', location: { latitude: 91, longitude: 77, capturedAt: Date.now() }, role: 'admin' })
  expect(context).toEqual({ page: '/dashboard', location: null, desktopScreenAvailable: false, desktopComputerAvailable: false })
  expect(sanitizeMiraClientContext({ location: { latitude: 23, longitude: 77, capturedAt: Date.now() - 600000 } }).location).toBeNull()
})
