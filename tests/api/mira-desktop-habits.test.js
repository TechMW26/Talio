import { musicRequest, recordDesktopHabit, desktopHabitHints, personalizeDesktopGoal, cleanDesktopHabits } from '@/lib/miraDesktopHabits'
import { POST, GET } from '@/app/api/mira/desktop-habits/route'
import { getAuthAndDatabase } from '@/lib/auth'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/security/rateLimiter', () => ({ rateLimit: jest.fn(async () => ({ allowed: true })) }))

test('learns explicit successful choices twice, not inferred defaults or repeated receipts', () => {
  let state = recordDesktopHabit(null, 'Play "Kesariya" on YouTube Music', 'one')
  expect(desktopHabitHints(state)).toBeNull()
  state = recordDesktopHabit(state, 'Play "Kesariya" on YouTube Music', 'one')
  expect(state.music[0].count).toBe(1)
  state = recordDesktopHabit(state, 'Play "Kesariya" on YouTube Music', 'two')
  expect(desktopHabitHints(state)).toEqual({ app: 'YouTube Music', song: 'Kesariya' })
  expect(personalizeDesktopGoal('Play some music', state)).toContain('installed YouTube Music')
  expect(personalizeDesktopGoal('Play some music', state)).toContain('Kesariya')
  expect(recordDesktopHabit(state, 'Play some music', 'three')).toEqual(state)
  expect(personalizeDesktopGoal('Play music on Spotify', state)).toBe('Play music on Spotify')
  expect(personalizeDesktopGoal('Play "Hello"', state)).not.toContain('Kesariya')
  expect(personalizeDesktopGoal('Play "Hello"', state)).toContain('YouTube Music')
})
test('does not interpret negative, ambiguous, informational, or messaging requests as habits', () => {
  for (const goal of ['Do not play music', 'How do I play music?', 'Play music on Spotify and YouTube Music', 'गाने मत चलाओ', 'Send Mansi a message', 'Play music; delete notes']) expect(musicRequest(goal)).toBeNull()
  expect(musicRequest('Play some music on YouTube Music')).toMatchObject({ app: 'YouTube Music', song: null })
  expect(musicRequest('गाने चलाओ')).toMatchObject({ genericOnly: true })
})
test('disabled, stale and tied app habits are not defaults', () => {
  const row = { app: 'Spotify', song: null, count: 2, lastUsed: Date.now() }
  expect(desktopHabitHints({ enabled: false, music: [row] })).toBeNull()
  expect(desktopHabitHints({ music: [row, { ...row, app: 'YouTube Music' }] })).toBeNull()
  expect(cleanDesktopHabits({ music: [{ ...row, lastUsed: Date.now() - 91 * 86400000 }] }).music).toEqual([])
})

let profile, auth
const request = body => new Request('http://localhost/api/mira/desktop-habits', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  process.env.JWT_SECRET = 'test-only-desktop-habits-secret'
  profile = { _id: 'u1' }
  auth = { success: true, tenant: { databaseName: 'tenant1' }, user: { _id: 'u1' }, database: {
    get: jest.fn(async () => profile), mutate: jest.fn(async (_collection, id, change) => { expect(id).toBe('u1'); profile = change(profile); return profile }) } }
  getAuthAndDatabase.mockImplementation(async () => auth)
})
test('prepare and verified completion bind original goals and de-duplicate retries', async () => {
  const prepared = await (await POST(request({ operation: 'prepare', goal: 'Play "Kesariya" on YouTube Music' }))).json()
  expect(profile.miraDesktopHabits).toBeUndefined()
  expect((await POST(request({ operation: 'complete', ticket: prepared.ticket }))).status).toBe(200)
  await POST(request({ operation: 'complete', ticket: prepared.ticket }))
  expect(profile.miraDesktopHabits.music[0].count).toBe(1)
  const result = await (await GET(new Request('http://localhost/api/mira/desktop-habits'))).json()
  expect(result.data.receipts).toBeUndefined()
  await POST(request({ operation: 'enabled', enabled: false }))
  expect(profile.miraDesktopHabits.enabled).toBe(false)
  await POST(request({ operation: 'clear' }))
  expect(profile.miraDesktopHabits.music).toEqual([])
  await POST(request({ operation: 'enabled', enabled: true }))
  await POST(request({ operation: 'complete', ticket: prepared.ticket }))
  expect(profile.miraDesktopHabits.music).toEqual([])
})
test('another user or tenant cannot complete or read the original account preferences', async () => {
  const { ticket } = await (await POST(request({ operation: 'prepare', goal: 'Play music on Spotify' }))).json()
  auth.tenant.databaseName = 'tenant2'
  expect((await POST(request({ operation: 'complete', ticket }))).status).toBe(400)
  expect(auth.database.mutate).not.toHaveBeenCalled()
  auth.tenant.databaseName = 'tenant1'; auth.user._id = 'u2'
  expect((await POST(request({ operation: 'complete', ticket }))).status).toBe(400)
  auth.success = false; auth.status = 403
  expect((await POST(request({ operation: 'prepare', goal: 'Play music' }))).status).toBe(403)
  expect((await GET(new Request('http://localhost/api/mira/desktop-habits'))).status).toBe(403)
})
test('tampered tickets and oversized bodies fail closed', async () => {
  expect((await POST(request({ operation: 'complete', ticket: 'invalid' }))).status).toBe(400)
  expect((await POST(request({ goal: 'x'.repeat(15000) }))).status).toBe(413)
  expect(auth.database.mutate).not.toHaveBeenCalled()
})
