import { isMiraPlaybackEcho, strengthenMiraEchoCancellation } from '@/lib/miraEchoGuard'

test.each([
  ['Your next meeting', 'Your next meeting is at ten.'],
  ['Your next meetings at ten', 'Your next meeting is at ten.'],
  ['मेरी attendance', 'आज मेरी attendance अच्छी है।'],
])('recognizes playback echo: %s', (heard, reply) => {
  expect(isMiraPlaybackEcho(heard, reply)).toBe(true)
})
test.each(['stop', 'wait a moment', 'What about tomorrow?', 'रुको'])('allows an unrelated interruption: %s', heard => {
  expect(isMiraPlaybackEcho(heard, 'Your next meeting is at ten.')).toBe(false)
})
test('upgrades to all-output AEC only if advertised by the device', async () => {
  const track = { getCapabilities: () => ({ echoCancellation: [true, false, 'all'] }), applyConstraints: jest.fn().mockResolvedValue() }
  await strengthenMiraEchoCancellation({ getAudioTracks: () => [track] })
  expect(track.applyConstraints).toHaveBeenCalledWith({ echoCancellation: { exact: 'all' }, noiseSuppression: true })
  track.applyConstraints.mockRejectedValue(new Error('Driver rejected mode'))
  await expect(strengthenMiraEchoCancellation({ getAudioTracks: () => [track] })).resolves.toBeUndefined()
  await expect(strengthenMiraEchoCancellation({ getAudioTracks: () => [{}] })).resolves.toBeUndefined()
})
