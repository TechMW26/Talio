jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))

import { getAuthAndDatabase } from '@/lib/auth'
import { GET, PUT } from '@/app/api/mira/preferences/route'

let profile
const database = {
  get: jest.fn(async () => profile),
  mutate: jest.fn(async (_collection, _id, change) => { profile = change(profile); return profile }),
}
const request = body => new Request('http://localhost/api/mira/preferences', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  profile = { _id: 'current-user', miraPreferences: {} }
  jest.clearAllMocks()
  getAuthAndDatabase.mockResolvedValue({ success: true, user: { _id: 'current-user' }, database })
})

test('returns the default voice and curated choices to every authenticated user', async () => {
  const result = await (await GET(new Request('http://localhost/api/mira/preferences'))).json()
  expect(result.success).toBe(true)
  expect(result.data.voiceId).toBe('ftDdhfYtmfGP0tFlBYA1')
  expect(result.voices).toHaveLength(6)
  expect(new Set(result.voices.map(voice => voice.id)).size).toBe(6)
  expect(new Set(result.voices.map(voice => voice.description)).size).toBe(6)
  expect(result.voices.every(voice => voice.accent === 'Indian')).toBe(true)
})

test('saves only supported personal fields to the authenticated profile', async () => {
  profile.miraPreferences = { lastGreetingDate: '2026-09-27', voiceEnabled: false }
  const result = await (await PUT(request({ voiceId: '6JsmTroalVewG1gA6Jmw', customInstructions: 'Be concise', knowledge: 'My team is Atlas', role: 'admin' }))).json()
  expect(result.success).toBe(true)
  expect(database.get).toHaveBeenCalledWith('users', 'current-user')
  expect(profile.miraPreferences).toMatchObject({ lastGreetingDate: '2026-09-27', voiceEnabled: false, voiceId: '6JsmTroalVewG1gA6Jmw', customInstructions: 'Be concise', knowledge: 'My team is Atlas' })
  expect(profile).not.toHaveProperty('role')
  expect(database.mutate).toHaveBeenCalledTimes(1)
})

test('rejects unsupported voices and overlong personalization', async () => {
  expect((await PUT(request({ voiceId: 'untrusted' }))).status).toBe(400)
  expect((await PUT(request({ customInstructions: 'x'.repeat(1601) }))).status).toBe(400)
  expect((await PUT(request({ knowledge: 'x'.repeat(8001) }))).status).toBe(400)
  expect(database.get).not.toHaveBeenCalled()
})

test('proactive preferences stay personal and preserve unspecified switches', async () => {
  profile.miraPreferences = { proactive: { enabled: true, tasks: false, quietStart: '21:30' } }
  const result = await (await PUT(request({ proactive: { meetings: false, timezone: 'Europe/London' }, owner: 'another-user' }))).json()
  expect(result.success).toBe(true)
  expect(profile.miraPreferences.proactive).toMatchObject({ enabled: true, tasks: false, meetings: false, timezone: 'Europe/London', quietStart: '21:30' })
  expect(profile).not.toHaveProperty('owner')
})

test('invalid proactive schedules and switches are rejected before a profile write', async () => {
  for (const proactive of [{ enabled: 'yes' }, { quietStart: '25:99' }, { timezone: 'Mars/Nowhere' }, []]) {
    expect((await PUT(request({ proactive }))).status).toBe(400)
  }
  expect(database.mutate).not.toHaveBeenCalled()
})
