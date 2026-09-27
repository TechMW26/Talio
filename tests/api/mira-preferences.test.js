jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))

import { getAuthAndModels } from '@/lib/auth'
import { GET, PUT } from '@/app/api/mira/preferences/route'

let profile
const User = {
  findById: jest.fn(() => ({
    select: () => ({
      lean: async () => profile,
      then: (resolve, reject) => Promise.resolve(profile).then(resolve, reject),
    }),
  })),
}
const request = body => new Request('http://localhost/api/mira/preferences', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  profile = { miraPreferences: {} }
  User.findById.mockClear()
  getAuthAndModels.mockResolvedValue({ success: true, user: { _id: 'current-user' }, models: { User } })
})

test('returns the default voice and curated choices to every authenticated user', async () => {
  const result = await (await GET(new Request('http://localhost/api/mira/preferences'))).json()
  expect(result.success).toBe(true)
  expect(result.data.voiceId).toBe('jJ0Hr51MaPgsgfPtFdR4')
  expect(result.voices).toHaveLength(6)
  expect(result.voices.map(voice => voice.id)).toContain('komDQG4wp0wC5IDFwetv')
})

test('saves only supported personal fields to the authenticated profile', async () => {
  const document = { miraPreferences: { lastGreetingDate: '2026-09-27', voiceEnabled: false }, save: jest.fn(async function () {}) }
  User.findById.mockReturnValueOnce({ select: () => document })
  const result = await (await PUT(request({ voiceId: 'EXAVITQu4vr4xnSDxMaL', customInstructions: 'Be concise', knowledge: 'My team is Atlas', role: 'admin' }))).json()
  expect(result.success).toBe(true)
  expect(User.findById).toHaveBeenCalledWith('current-user')
  expect(document.miraPreferences).toEqual({ lastGreetingDate: '2026-09-27', voiceEnabled: false, voiceId: 'EXAVITQu4vr4xnSDxMaL', customInstructions: 'Be concise', knowledge: 'My team is Atlas' })
  expect(document.save).toHaveBeenCalledTimes(1)
})

test('rejects unsupported voices and overlong personalization', async () => {
  expect((await PUT(request({ voiceId: 'untrusted' }))).status).toBe(400)
  expect((await PUT(request({ customInstructions: 'x'.repeat(1601) }))).status).toBe(400)
  expect((await PUT(request({ knowledge: 'x'.repeat(8001) }))).status).toBe(400)
  expect(User.findById).not.toHaveBeenCalled()
})
