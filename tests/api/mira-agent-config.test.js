jest.mock('jose', () => ({ SignJWT: jest.fn(), jwtVerify: jest.fn() }))
import { miraAgentConfig, miraAgentPromptHash, miraAgentCanStart, syncMiraAgent, MIRA_AGENT_LANGUAGES } from '@/lib/miraVoiceAgent.server'
import { MIRA_CORE_SYSTEM_PROMPT, MIRA_AGENT_SYSTEM_PROMPT, MIRA_VOICE_AUDIO_TAGS, MIRA_VOICE_EXPRESSION_POLICY, MIRA_VOICE_CONVERSATION_STYLE } from '@/lib/miraSystemPrompt'
import { miraDeepSeekRequest } from '@/lib/miraAgentGateway'
import { miraAgentVoice } from '@/lib/miraVoices'
import { miraVoiceTranscript } from '@/lib/miraMessageDisplay'

test('private full v4 agent uses the authenticated DeepSeek gateway and internet tools', () => {
  const config = miraAgentConfig()
  expect(config.name).toBe('Mira')
  expect(config.conversation_config.tts.model_id).toBe('eleven_v4')
  expect(config.conversation_config.tts.voice_id).toBe('ftDdhfYtmfGP0tFlBYA1')
  expect(config.conversation_config.tts.speed).toBe(1.2)
  expect(config.conversation_config.tts.stability).toBe(0.4)
  expect(config.conversation_config.tts.expressive_mode).toBe(true)
  expect(config.conversation_config.tts.suggested_audio_tags).toEqual(MIRA_VOICE_AUDIO_TAGS)
  expect(config.conversation_config.agent.prompt.prompt).toContain(MIRA_VOICE_EXPRESSION_POLICY)
  expect(config.conversation_config.tts.suggested_audio_tags).toContainEqual(expect.objectContaining({ tag: 'laughs' }))
  expect(config.conversation_config.tts.suggested_audio_tags.some(tag => tag.tag === 'slow')).toBe(false)
  expect(config.conversation_config.turn.turn_eagerness).toBe('eager')
  expect(config.conversation_config.turn.soft_timeout_config).toMatchObject({ timeout_seconds: 0.8, use_llm_generated_message: true, max_soft_timeouts_per_generation: 1, disable_until_first_user_message: true })
  expect(config.conversation_config.asr).toMatchObject({ provider: 'scribe_realtime', quality: 'high' })
  expect(config.conversation_config.agent).toMatchObject({ language: 'en', hinglish_mode: false })
  expect(Object.keys(config.conversation_config.language_presets).sort()).toEqual([...MIRA_AGENT_LANGUAGES].sort())
  expect(MIRA_AGENT_LANGUAGES).toEqual(['en', 'hi'])
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('English and Hindi only')
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('not the numeric speed setting')
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('Make genuine emotion audible')
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('one fitting delivery cue in every spoken reply')
  for (const { tag } of MIRA_VOICE_AUDIO_TAGS) expect(miraVoiceTranscript(`[${tag}] Hello`)).toBe('Hello')
  expect(config.conversation_config.agent.prompt.tools).toContainEqual(expect.objectContaining({ name: 'language_detection', params: { system_tool_type: 'language_detection', only_at_conversation_start: false } }))
  expect(config.conversation_config.agent.prompt.prompt).toContain(MIRA_CORE_SYSTEM_PROMPT)
  expect(config.conversation_config.agent.prompt.prompt).toBe(MIRA_AGENT_SYSTEM_PROMPT)
  expect(config.conversation_config.agent.prompt.llm).toBe('custom-llm')
  expect(config.conversation_config.agent.prompt.custom_llm).toEqual({ url: 'https://app.talio.in/api/ai/mira-agent/llm', model_id: 'talio-mira', api_type: 'chat_completions' })
  expect(config.conversation_config.agent.prompt).toMatchObject({ thinking_budget: 0, enable_reasoning_summary: false })
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('desktop/system control')
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('answer ordinary conversation')
  expect(MIRA_AGENT_SYSTEM_PROMPT).not.toContain('Every final user utterance must go through')
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('मैं सुन रही हूँ')
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('write Hindi words in Devanagari')
  expect(MIRA_AGENT_SYSTEM_PROMPT).not.toContain('Hindi-English requests always receive natural Roman-script Hinglish')
  expect(config.conversation_config.agent.prompt.tools).toContainEqual(expect.objectContaining({ name: 'search_internet', expects_response: true }))
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain('Use [laughs] or [chuckles] only for genuinely humorous moments')
  expect(config.conversation_config.agent.prompt.tools).toContainEqual(expect.objectContaining({ name: 'skip_turn', pre_tool_speech: 'off', params: { system_tool_type: 'skip_turn', wait_timeout_secs: -1 } }))
  expect(config.conversation_config.turn).toMatchObject({ turn_timeout: 30, silence_end_call_timeout: -1 })
  expect(config.conversation_config.turn.speculative_turn).toBe(false)
  expect(config.platform_settings.auth.enable_auth).toBe(true)
  expect(config.platform_settings.privacy).toMatchObject({ record_voice: false, delete_audio: true })
  expect(config.platform_settings.overrides).toEqual({ custom_llm_extra_body: true, conversation_config_override: { agent: { language: true }, tts: { voice_id: true } } })
  expect(miraAgentPromptHash()).toMatch(/^[a-f0-9]{64}$/)
})
test('DeepSeek and the voice agent share brief spoken examples without forced filler or a minimum sentence length', () => {
  const gateway = miraDeepSeekRequest({ messages: [{ role: 'user', content: 'Can you hear me?' }] }, 'en')
  for (const prompt of [miraAgentConfig().conversation_config.agent.prompt.prompt, gateway.messages[0].content]) {
    expect(prompt.split(MIRA_VOICE_CONVERSATION_STYLE)).toHaveLength(2)
    expect(prompt).toContain('Default to one short sentence')
    expect(prompt).toContain('never omit essential facts, uncertainty or safety information')
    expect(prompt).toContain('not manufactured mistakes, filler quotas, fake hesitation or extra latency')
    expect(prompt).toContain("[confident] It's open.")
    expect(prompt).toContain('[confident] खुल गया।')
    expect(prompt).toContain('Do not say this before the tool confirms success')
    expect(prompt).not.toContain('usually 5–12 words')
  }
})

test.each(['en', 'hi'])('spoken examples reach the %s gateway without overriding language or tool outcomes', language => {
  const gateway = miraDeepSeekRequest({ messages: [{ role: 'user', content: language === 'hi' ? 'शुक्रिया, काम हो गया' : 'That helped, thanks' }] }, language)
  const prompt = gateway.messages[0].content
  expect(prompt).toContain(MIRA_VOICE_CONVERSATION_STYLE)
  expect(prompt).toContain(`CURRENT SPEECH LANGUAGE: ${language}`)
  expect(prompt).toContain('never both translations')
  expect(prompt).toContain('fictional reference data, not facts about this caller')
  expect(prompt).toContain('never retrieve an example as an answer')
  expect(prompt).toContain('Never claim completion or automatically repeat the write')
  expect(prompt).toContain('call skip_turn with no spoken reply')
  expect(prompt).toContain('give the full requested explanation in short spoken chunks')
})

test('spoken reference examples cover varied situations with supported emotion cues and native Hindi', () => {
  const examples = MIRA_VOICE_CONVERSATION_STYLE.split('\n').filter(line => line.startsWith('- '))
  expect(examples).toHaveLength(20)
  // Two non-spoken/long-form guidance examples follow the bilingual short replies.
  for (const example of examples.slice(0, -2)) {
    expect(example).toMatch(/[\u0900-\u097f]/)
    const cues = [...example.matchAll(/\[([a-z]+)\]/g)].map(match => match[1])
    expect(cues).toHaveLength(2)
    for (const cue of cues) expect(MIRA_VOICE_AUDIO_TAGS.map(({ tag }) => tag)).toContain(cue)
  }
  expect(MIRA_VOICE_CONVERSATION_STYLE).toContain('not scripts to repeat')
  expect(MIRA_VOICE_CONVERSATION_STYLE).toContain('do not infer the user\'s gender')
  expect(MIRA_VOICE_CONVERSATION_STYLE).toContain('do not invent self-corrections')
})

test('does not attempt provider writes for a non-administrator', async () => {
  await expect(syncMiraAgent({}, { role: 'employee' }, 'tenant')).rejects.toMatchObject({ status: 403 })
})
test('only the verified gateway configuration can keep serving during a prompt-only sync delay', () => {
  expect(miraAgentCanStart({ agentId: 'owned', promptHash: miraAgentPromptHash() })).toBe(true)
  const compatible = { agentId: 'owned', model: 'eleven_v4', promptHash: 'fcd643aac5053f63e607f4a0681b7be4cd68139ec113176d777a8433980fbaf3' }
  expect(miraAgentCanStart(compatible)).toBe(true)
  expect(miraAgentCanStart({ ...compatible, promptHash: 'unknown-native-agent' })).toBe(false)
  expect(miraAgentCanStart({ ...compatible, model: 'other' })).toBe(false)
  expect(miraAgentCanStart({ ...compatible, agentId: null })).toBe(false)
})
test('retired choices fall back to an Indian live-compatible voice', () => {
  expect(miraAgentVoice('jJ0Hr51MaPgsgfPtFdR4')).toMatchObject({ voiceId: 'ftDdhfYtmfGP0tFlBYA1', voiceName: 'Alisha · Indian', notice: '' })
  expect(miraAgentVoice('iWq9tCtTw1SYmVpvsRjY')).toMatchObject({ voiceId: 'iWq9tCtTw1SYmVpvsRjY', notice: '' })
})
