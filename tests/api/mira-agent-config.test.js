jest.mock('jose', () => ({ SignJWT: jest.fn(), jwtVerify: jest.fn() }))
import { miraAgentConfig, miraAgentPromptHash, syncMiraAgent } from '@/lib/miraVoiceAgent.server'
import { MIRA_CORE_SYSTEM_PROMPT, MIRA_AGENT_SYSTEM_PROMPT } from '@/lib/miraSystemPrompt'
import { miraAgentVoice } from '@/lib/miraVoices'

test('private v4 Turbo agent uses a single shared brain and forbids speculative execution', () => {
  const config = miraAgentConfig()
  expect(config.name).toBe('Mira')
  expect(config.conversation_config.tts.model_id).toBe('eleven_v4_turbo')
  expect(config.conversation_config.tts.voice_id).toBe('ftDdhfYtmfGP0tFlBYA1')
  expect(config.conversation_config.asr).toMatchObject({ provider: 'scribe_realtime', quality: 'high' })
  expect(config.conversation_config.agent).toMatchObject({ language: 'hi', hinglish_mode: true })
  expect(Object.keys(config.conversation_config.language_presets).sort()).toEqual(['en', 'hi'])
  expect(config.conversation_config.agent.prompt.prompt).toContain(MIRA_CORE_SYSTEM_PROMPT)
  expect(config.conversation_config.agent.prompt.prompt).toBe(MIRA_AGENT_SYSTEM_PROMPT)
  expect(config.conversation_config.agent.prompt.llm).toBe('custom-llm')
  expect(config.conversation_config.agent.prompt.custom_llm.url).toBe('https://app.talio.in/api/ai/mira-agent/llm')
  expect(config.conversation_config.turn.speculative_turn).toBe(false)
  expect(config.platform_settings.auth.enable_auth).toBe(true)
  expect(config.platform_settings.privacy).toMatchObject({ record_voice: false, delete_audio: true })
  expect(config.platform_settings.overrides).toEqual({ custom_llm_extra_body: true, conversation_config_override: { tts: { voice_id: true } } })
  expect(miraAgentPromptHash()).toMatch(/^[a-f0-9]{64}$/)
})
test('does not attempt provider writes for a non-administrator', async () => {
  await expect(syncMiraAgent({}, { role: 'employee' }, 'tenant')).rejects.toMatchObject({ status: 403 })
})
test('instant-clone restriction is explicit without overwriting saved preferences', () => {
  expect(miraAgentVoice('jJ0Hr51MaPgsgfPtFdR4')).toMatchObject({ voiceId: 'ftDdhfYtmfGP0tFlBYA1', voiceName: 'Alisha · Indian', notice: expect.stringContaining('instant-cloned') })
  expect(miraAgentVoice('FGY2WhTYpPnrIDTdsKH5')).toMatchObject({ voiceId: 'FGY2WhTYpPnrIDTdsKH5', notice: '' })
})
