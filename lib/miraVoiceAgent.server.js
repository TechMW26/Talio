import { createHash, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { MIRA_AGENT_SYSTEM_PROMPT, MIRA_VOICE_AUDIO_TAGS } from './miraSystemPrompt'
import { DEFAULT_MIRA_AGENT_VOICE_ID } from './miraVoices'
import { getMiraSettings, updateMiraSettings } from './miraAccess.server'

const API = 'https://api.elevenlabs.io/v1/convai'
export const MIRA_AGENT_MODEL = 'eleven_v4'
export const MIRA_AGENT_LLM = 'custom-llm'
// Verified against the shared v4 and live-agent language catalogs. Resolve at
// configuration time, never fetch a provider catalog for every conversation.
export const MIRA_AGENT_LANGUAGES = 'af am ar hy as ast az be bn bs bg my yue ca hr cs da nl en et fil fi fr gl ka de el gu ha he hi hu is id ga it ja jv kn kk ky ko lo lv lt lg lb mk ms ml mt zh mi mr mn ne no oc or ps fa pl pt pa ro ru sr sn sd sk sl so ckb es sw sv tg ta te th tr uk ur uz vi cy wo yo zu'.split(' ')
const AUDIENCE = 'mira-voice-bridge'
const bridgeKey = () => {
  if (!process.env.JWT_SECRET) throw new Error('Voice credentials are not configured')
  // Separate signing key and audience: these tokens cannot log into Talio.
  return createHash('sha256').update(`mira-voice-bridge:${process.env.JWT_SECRET}`).digest()
}

export function miraAgentConfig() {
  return {
    name: 'Mira',
    conversation_config: {
      asr: { provider: 'scribe_realtime', quality: 'high', user_input_audio_format: 'pcm_16000', keywords: ['Mira', 'Talio'] },
      agent: { first_message: '', language: 'en', hinglish_mode: false, disable_first_message_interruptions: false,
        prompt: { prompt: MIRA_AGENT_SYSTEM_PROMPT, llm: MIRA_AGENT_LLM, temperature: 0,
          thinking_budget: 0, enable_reasoning_summary: false, max_tokens: 512, timezone: 'Asia/Kolkata',
          ignore_default_personality: true,
          custom_llm: { url: 'https://app.talio.in/api/ai/mira-agent/llm', model_id: 'talio-mira', api_type: 'chat_completions' },
          tools: [{ type: 'client', name: 'search_internet', description: 'Search public internet information when the user asks for research, recent facts, public websites/companies/products or unfamiliar public terms. Search before claiming no information exists. Not for private workplace records. Pass the exact user utterance, including spelling corrections; do not add private context.', expects_response: true, response_timeout_secs: 30, interruption_mode: 'allow', pre_tool_speech: 'off', execution_mode: 'immediate', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Exact final user utterance' }, utterance_id: { type: 'string', description: 'Stable turn identifier' } }, required: ['message', 'utterance_id'] } },
            { type: 'client', name: 'ask_mira', description: 'Authenticated Talio data, private context, live lookups, navigation and desktop/system actions. Not for ordinary conversation or audibility checks. Returns verified spoken results.',
            expects_response: true, response_timeout_secs: 120, interruption_mode: 'allow', pre_tool_speech: 'off', execution_mode: 'immediate',
            parameters: { type: 'object', properties: { message: { type: 'string', description: 'Exact final user utterance' }, utterance_id: { type: 'string', description: 'Stable turn identifier' } }, required: ['message', 'utterance_id'] } },
            { type: 'client', name: 'close_mira', description: 'End this call and close Mira immediately only when the user clearly asks to end the conversation or says goodbye. Never for quoted, hypothetical or negated closing instructions. Use this instead of ask_mira for closing.', expects_response: false, pre_tool_speech: 'off', execution_mode: 'immediate', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Exact final user request to end the call' } }, required: ['message'] } },
            { type: 'system', name: 'skip_turn', description: 'Stay completely silent when there is no new meaningful user speech, during silence timeouts, or when the user wants a pause. Never check in or speak before this tool.', pre_tool_speech: 'off', interruption_mode: 'allow', params: { system_tool_type: 'skip_turn', wait_timeout_secs: -1 } },
            { type: 'system', name: 'language_detection', description: 'Switch immediately whenever the user clearly speaks in another supported language or asks to change languages, at any point in the call. Use the detected spoken language and meaning, not just transcription script. Keep the selected female voice and do not announce the switch. Never switch for a name, spelling, quoted passage, one borrowed word, silence or playback echo.', pre_tool_speech: 'off', interruption_mode: 'allow', params: { system_tool_type: 'language_detection', only_at_conversation_start: false } }] },
      },
      language_presets: Object.fromEntries(MIRA_AGENT_LANGUAGES.map(language => [language, { overrides: { agent: { language, first_message: '' } } }])),
      tts: { model_id: MIRA_AGENT_MODEL, voice_id: DEFAULT_MIRA_AGENT_VOICE_ID, expressive_mode: true, suggested_audio_tags: MIRA_VOICE_AUDIO_TAGS,
        speed: 1.2, stability: 0.55, similarity_boost: 0.75 },
      turn: { turn_timeout: 30, initial_wait_time: 30, silence_end_call_timeout: -1, turn_eagerness: 'eager', speculative_turn: false, retranscribe_on_turn_timeout: false,
        soft_timeout_config: { timeout_seconds: -1, use_llm_generated_message: false } },
      conversation: { max_duration_seconds: 600, client_events: ['audio', 'interruption', 'user_transcript', 'agent_response', 'client_tool_call', 'vad_score'] },
    },
    platform_settings: {
      auth: { enable_auth: true },
      privacy: { record_voice: false, retention_days: 1, delete_audio: true, delete_transcript_and_pii: true },
      overrides: { custom_llm_extra_body: true, conversation_config_override: { agent: { language: true }, tts: { voice_id: true } } },
    },
  }
}

export function miraAgentPromptHash() {
  return createHash('sha256').update(JSON.stringify(miraAgentConfig())).digest('hex')
}

export async function elevenAgentRequest(path, { method = 'GET', body } = {}) {
  if (!process.env.ELEVENLABS_API_KEY) throw Object.assign(new Error('ElevenLabs is not configured'), { status: 503 })
  const response = await fetch(`${API}${path}`, { method, headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000), cache: 'no-store' })
  if (!response.ok) {
    // Do not relay provider bodies containing prompt/configuration or credentials.
    throw Object.assign(new Error(`ElevenLabs agent request failed (${response.status})`), { status: 502 })
  }
  return response.json()
}

const syncs = new Map()
export async function syncMiraAgent(database, actor, tenantName) {
  if (actor.role !== 'admin') throw Object.assign(new Error('Administrator access is required'), { status: 403 })
  if (syncs.has(tenantName)) return syncs.get(tenantName)
  const promise = (async () => {
    const settings = await getMiraSettings(database)
    const config = miraAgentConfig(), promptHash = miraAgentPromptHash()
    let agentId = settings.agent?.agentId
    // Update only this tenant's explicitly owned agent; never search and overwrite by name.
    if (agentId) await elevenAgentRequest(`/agents/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: config })
    else agentId = (await elevenAgentRequest('/agents/create', { method: 'POST', body: config })).agent_id
    if (!agentId) throw new Error('ElevenLabs did not return an agent ID')
    const agent = { agentId, promptHash, model: MIRA_AGENT_MODEL, syncedAt: new Date().toISOString() }
    await updateMiraSettings(database, actor, { agent })
    return agent
  })().finally(() => syncs.delete(tenantName))
  syncs.set(tenantName, promise)
  return promise
}

export async function createMiraBridgeCredential(user, tenant) {
  const expires = Math.min(Math.floor(Date.now() / 1000) + 660, Number(user.exp) || Infinity)
  return new SignJWT({ purpose: AUDIENCE, userId: String(user._id || user.userId), databaseName: tenant.databaseName,
    companySlug: tenant.companySlug, authVersion: user.authVersion || 0, tokenId: user.tokenId, accounting: 'gateway' })
    .setProtectedHeader({ alg: 'HS256' }).setAudience(AUDIENCE).setJti(randomUUID()).setIssuedAt().setExpirationTime(expires).sign(bridgeKey())
}

export async function verifyMiraBridgeCredential(token) {
  const { payload } = await jwtVerify(token, bridgeKey(), { algorithms: ['HS256'], audience: AUDIENCE })
  if (payload.purpose !== AUDIENCE || !payload.userId || !payload.databaseName) throw new Error('Invalid voice credential')
  return payload
}

export async function miraBridgeAuthRequest(payload, requestUrl) {
  // This normal auth token stays server-side. Existing auth rechecks the original
  // session, user, authVersion, plan and designation on every voice turn.
  const { aud, purpose, iat, exp, ...claims } = payload
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(exp)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET))
  return new Request(requestUrl, { headers: { Authorization: `Bearer ${token}` } })
}
