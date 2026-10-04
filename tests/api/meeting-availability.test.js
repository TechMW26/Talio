import { refreshMeetingAvailability, EMPTY_ROOM_GRACE_MS } from '@/lib/meetings/meetingAvailability.server'
import { getMeetingParticipantCount } from '@/lib/meetings/livekit.server'
jest.mock('@/lib/meetings/livekit.server', () => ({ getMeetingParticipantCount: jest.fn() }))
const now = new Date('2026-09-29T12:00:00Z')
const base = () => ({ _id: 'meeting', roomId: 'room', type: 'online', status: 'in-progress', isLinkActive: true, scheduledEnd: new Date('2026-09-29T11:00:00Z') })
let Meeting, current
beforeEach(() => { jest.clearAllMocks(); current = null; Meeting = { mutate: jest.fn(async (name, id, update) => update(current || base())) }; getMeetingParticipantCount.mockResolvedValue(0) })
test('occupied overdue meeting continues and resets the empty-room timer', async () => {
  getMeetingParticipantCount.mockResolvedValue(2)
  current = { ...base(), roomEmptySince: new Date(now - 700000) }
  const state = await refreshMeetingAvailability(Meeting, current, 'tenant', now)
  expect(state).toMatchObject({ status: 'in-progress', continuing: true, isLinkActive: true, roomEmptySince: null, roomParticipantCount: 2 })
  expect(getMeetingParticipantCount).toHaveBeenCalledWith('tenant', 'room')
})
test('last departure starts a full ten-minute rejoin window', async () => {
  const state = await refreshMeetingAvailability(Meeting, base(), 'tenant', now)
  expect(state.roomEmptySince).toEqual(now)
  expect(state.isLinkActive).toBe(true)
})
test.each([0, 599999])('empty room stays joinable %s ms after last departure', async elapsed => {
  current = { ...base(), roomEmptySince: new Date(now - elapsed) }
  const state = await refreshMeetingAvailability(Meeting, current, 'tenant', now)
  expect(state.isLinkActive).toBe(true)
})
test('at ten minutes the empty meeting completes and link closes', async () => {
  const left = new Date(now - EMPTY_ROOM_GRACE_MS)
  current = { ...base(), roomEmptySince: left }
  const state = await refreshMeetingAvailability(Meeting, current, 'tenant', now)
  expect(state).toMatchObject({ status: 'completed', isLinkActive: false, continuing: false, actualEnd: left })
})
test('an early last departure also closes after ten minutes', async () => {
  current = { ...base(), scheduledEnd: new Date(now.getTime() + 3600000), roomEmptySince: new Date(now - EMPTY_ROOM_GRACE_MS) }
  const state = await refreshMeetingAvailability(Meeting, current, 'tenant', now)
  expect(state.status).toBe('completed')
})
test('future unstarted meetings do not start an empty timer', async () => {
  current = { ...base(), status: 'scheduled', scheduledEnd: new Date(now.getTime() + 3600000) }
  const state = await refreshMeetingAvailability(Meeting, current, 'tenant', now)
  expect(state.roomEmptySince).toBeUndefined()
})
test.each(['completed', 'cancelled'])('never reopens explicitly closed %s meetings', async status => {
  expect((await refreshMeetingAvailability(Meeting, { ...base(), status }, 'tenant', now)).status).toBe(status)
  expect(getMeetingParticipantCount).not.toHaveBeenCalled()
})
test('provider outages do not deactivate a meeting', async () => {
  getMeetingParticipantCount.mockRejectedValue(new Error('Unavailable'))
  await expect(refreshMeetingAvailability(Meeting, base(), 'tenant', now)).rejects.toThrow('Unavailable')
  expect(Meeting.mutate).not.toHaveBeenCalled()
})
test('stale empty observation cannot overwrite a newer rejoin', async () => {
  const fresh = { ...base(), roomEmptySince: null, roomParticipantCount: 1 }
  current = fresh
  const state = await refreshMeetingAvailability(Meeting, { ...base(), roomEmptySince: new Date(now - EMPTY_ROOM_GRACE_MS) }, 'tenant', now)
  expect(state).toBe(fresh)
  expect(Meeting.mutate).toHaveBeenCalledTimes(1)
})
