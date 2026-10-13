jest.mock('jose', () => ({ SignJWT: jest.fn(), jwtVerify: jest.fn() }))
jest.mock('@/lib/miraAccess.server', () => ({ getMiraSettings: jest.fn(), updateMiraSettings: jest.fn() }))
import { elevenAgentRequest, syncMiraAgent, miraAgentConfig } from '@/lib/miraVoiceAgent.server'
import { getMiraSettings, updateMiraSettings } from '@/lib/miraAccess.server'

beforeEach(() => {
  jest.clearAllMocks()
  process.env.ELEVENLABS_API_KEY = 'test-only'
  getMiraSettings.mockResolvedValue({ agent: { agentId: 'owned-agent' } })
})
afterEach(() => { jest.restoreAllMocks(); delete process.env.ELEVENLABS_API_KEY })
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
test('timeout is a safe retryable response, without exposing provider details', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('private upstream detail'), { name: 'TimeoutError' }))
  await expect(elevenAgentRequest('/agents/owned-agent')).rejects.toMatchObject({ status: 504, message: 'Mira’s voice service timed out. Please retry shortly.' })
})
test('recovers a confirmed update after a timeout without a second write or replacement agent', async () => {
  const fetch = jest.spyOn(global, 'fetch').mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' })).mockResolvedValueOnce(json(miraAgentConfig()))
  const agent = await syncMiraAgent({}, { _id: 'admin', role: 'admin' }, 'tenant')
  expect(agent.agentId).toBe('owned-agent')
  expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['PATCH', 'GET'])
  expect(updateMiraSettings).toHaveBeenCalledTimes(1)
})
test('failed or unconfirmed provider updates never advance local sync metadata', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(json({ conversation_config: { agent: { prompt: { prompt: 'old' } } } }))
  await expect(syncMiraAgent({}, { role: 'admin' }, 'tenant')).rejects.toMatchObject({ status: 503 })
  expect(updateMiraSettings).not.toHaveBeenCalled()
})
test('an uncertain create is never retried automatically', async () => {
  getMiraSettings.mockResolvedValue({ agent: null })
  const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
  await expect(syncMiraAgent({}, { role: 'admin' }, 'tenant')).rejects.toMatchObject({ status: 504 })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(updateMiraSettings).not.toHaveBeenCalled()
})
test.each(['eagerness', 'fillers'])('sync does not claim success when provider keeps stale %s settings', async setting => {
  const stale = miraAgentConfig()
  if (setting === 'eagerness') stale.conversation_config.turn.turn_eagerness = 'patient'
  else stale.conversation_config.turn.soft_timeout_config.use_llm_generated_message = false
  jest.spyOn(global, 'fetch').mockResolvedValue(json(stale))
  await expect(syncMiraAgent({}, { role: 'admin' }, 'tenant')).rejects.toMatchObject({ status: 502 })
  expect(updateMiraSettings).not.toHaveBeenCalled()
})
