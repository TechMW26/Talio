import { Firestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { MEETING_STORE_OPTIONS, createMeetingSeries, listMeetings, updateMeeting, respondToMeeting } from '@/lib/meetings/store.server'
import { refreshMeetingAvailability } from '@/lib/meetings/meetingAvailability.server'
import { getMeetingParticipantCount } from '@/lib/meetings/livekit.server'
jest.mock('@/lib/meetings/livekit.server', () => ({ getMeetingParticipantCount: jest.fn() }))
const suite = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(45000)
suite('native meeting transactions and access scopes', () => {
  let firestore, database
  const organizer = { _id: '111111111111111111111111', firstName: 'Host', lastName: 'Test', status: 'active' }
  const invitee = { _id: '222222222222222222222222', firstName: 'Guest', lastName: 'Test', status: 'active' }
  const user = '333333333333333333333333'
  const input = { title: 'Review', type: 'online', scheduledStart: '2026-11-01T10:00:00Z', scheduledEnd: '2026-11-01T11:00:00Z', inviteeIds: [invitee._id] }
  beforeAll(() => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
  })
  afterAll(async () => firestore?.terminate())
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: `test-meetings-${Date.now()}-${randomBytes(4).toString('hex')}`, databaseName: 'talio_company_test', ...MEETING_STORE_OPTIONS })
    await database.create('employees', organizer); await database.create('employees', invitee)
  })
  test('indexed owner and invitee scopes exclude unrelated meetings', async () => {
    const [meeting] = await createMeetingSeries(database, input, organizer)
    await createMeetingSeries(database, { ...input, title: 'Private', inviteeIds: [] }, { ...organizer, _id: '444444444444444444444444' })
    const records = await listMeetings(database, invitee, new URLSearchParams())
    expect(records.records.map(row => row._id)).toEqual([meeting._id])
    expect((await listMeetings(database, { _id: '555555555555555555555555' }, new URLSearchParams())).records).toHaveLength(0)
  })
  test('invitation response updates only recipient notification atomically', async () => {
    const [meeting] = await createMeetingSeries(database, input, organizer)
    for (const [id, who] of [['aaaa', user], ['bbbb', 'other-user']]) await database.create('actionablenotifications', { _id: id, user: who, status: 'pending', reference: { model: 'Meeting', id: meeting._id } })
    await respondToMeeting(database, meeting._id, invitee, user, 'accepted')
    expect((await database.get('actionablenotifications', 'aaaa')).status).toBe('actioned')
    expect((await database.get('actionablenotifications', 'bbbb')).status).toBe('pending')
    expect((await database.get('meetings', meeting._id)).invitees[0].status).toBe('accepted')
  })
  test('concurrent invitee additions preserve both and forbid non-organizer edit', async () => {
    const [meeting] = await createMeetingSeries(database, input, organizer)
    const ids = ['666666666666666666666666', '777777777777777777777777']
    for (const id of ids) await database.create('employees', { ...invitee, _id: id })
    await Promise.all(ids.map(id => updateMeeting(database, meeting._id, organizer, { addInvitees: [id] })))
    expect((await database.get('meetings', meeting._id)).invitees).toHaveLength(3)
    await expect(updateMeeting(database, meeting._id, invitee, { title: 'No' })).rejects.toMatchObject({ status: 403 })
  })
  test('presence compare-and-set does not overwrite a newer cancellation', async () => {
    const [meeting] = await createMeetingSeries(database, input, organizer)
    await database.mutate('meetings', meeting._id, row => ({ ...row, status: 'cancelled' }))
    getMeetingParticipantCount.mockResolvedValue(2)
    const refreshed = await refreshMeetingAvailability(database, meeting, 'talio_company_test')
    expect(refreshed.status).toBe('cancelled')
  })
  test('response rollback preserves both invitation and prompt', async () => {
    const [meeting] = await createMeetingSeries(database, input, organizer)
    await database.create('actionablenotifications', { _id: 'aaaa', user, status: 'pending', reference: { model: 'Meeting', id: meeting._id } })
    const failing = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx, replace: (name, row) => name === 'actionablenotifications' ? Promise.reject(new Error('fail')) : tx.replace(name, row) })) }
    await expect(respondToMeeting(failing, meeting._id, invitee, user, 'accepted')).rejects.toThrow('fail')
    expect((await database.get('meetings', meeting._id)).invitees[0].status).toBe('pending')
  })
})
