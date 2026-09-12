import { validateAudioSegment, readMeetingAudio, MAX_AUDIO_SEGMENT_BYTES } from '@/lib/platform/meetingAudio.server'
import { getTenantConnection } from '@/lib/tenantDb'
jest.mock('@/lib/tenantDb', () => ({ getTenantConnection: jest.fn() }))
const file = { size: 100, type: 'audio/webm;codecs=opus', arrayBuffer: async () => new ArrayBuffer(100) }
test('accepts a bounded audio segment', () => expect(validateAudioSegment(file, 30)).toBeNull())
test.each([
  [null, 30], [{ ...file, size: 0 }, 30], [{ ...file, size: MAX_AUDIO_SEGMENT_BYTES + 1 }, 30],
  [{ ...file, type: 'text/html' }, 30], [file, NaN], [file, -1],
])('rejects invalid uploads', (upload, duration) => expect(validateAudioSegment(upload, duration)).toEqual(expect.any(String)))
test('rejects malformed storage IDs without touching the database', async () => {
  expect(await readMeetingAudio('tenant_a', 'meeting', '../bad')).toBeNull()
  expect(getTenantConnection).not.toHaveBeenCalled()
})
