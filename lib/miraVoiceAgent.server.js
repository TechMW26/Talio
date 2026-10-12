import { createHash } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { MIRA_AGENT_SYSTEM_PROMPT } from './miraSystemPrompt'
import { DEFAULT_MIRA_AGENT_VOICE_ID } from './miraVoices'
import { getMiraSettings, updateMiraSettings } from './miraAccess.server'

const API = 'https://api.elevenlabs.io/v1/convai'
export const MIRA_AGENT_MODEL = 'eleven_v4_turbo'
const AUDIENCE = 'mira-voice-bridge'
const bridgeKey = () => {
  if (!process.env.JWT_SECRET) throw new Error('Voice credentials are not configured')
  // Separate signing key and audience: these tokens cannot log into Talio.
  return createHash('sha256').update(`mira-voice-bridge:${process.env.JWT_SECRET}`).digest()
}

export function miraAgentConfig() {
  const origin = process.env.MIRA_AGENT_PUBLIC_ORIGIN || 'https://app.talio.in'
  // The provider appends /chat/completions; that route shares the gateway below.
  const url = new URL('/api/ai/mira-agent/llm', origin)
  if (url.protocol !== 'https:') throw new Error('Mira agent requires a public HTTPS origin')
  return {
    name: 'Mira',
    conversation_config: {
      asr: { provider: 'scribe_realtime', quality: 'high', user_input_audio_format: 'pcm_16000', keywords: ['Mira', 'Talio'] },
      agent: { first_message: '', language: 'hi', hinglish_mode: true, disable_first_message_interruptions: false,
        prompt: { prompt: MIRA_AGENT_SYSTEM_PROMPT, llm: 'custom-llm', temperature: 0,
          ignore_default_personality: true,
          custom_llm: { url: url.href, api_type: 'chat_completions', model_id: 'talio-mira' },
          tools: [{ type: 'client', name: 'ask_mira', description: 'Run the final utterance through authenticated Talio Mira once.',
            expects_response: true, response_timeout_secs: 120, interruption_mode: 'allow', pre_tool_speech: 'off', execution_mode: 'immediate',
            parameters: { type: 'object', properties: { message: { type: 'string', description: 'Exact final user utterance' }, utterance_id: { type: 'string', description: 'Stable turn identifier' } }, required: ['message', 'utterance_id'] } }] },
      },
      language_presets: { en: { overrides: { agent: { language: 'en' } } }, hi: { overrides: { agent: { language: 'hi' } } } },
      tts: { model_id: MIRA_AGENT_MODEL, voice_id: DEFAULT_MIRA_AGENT_VOICE_ID, stability: 0.5, similarity_boost: 0.75 },
      turn: { turn_eagerness: 'normal', speculative_turn: false, retranscribe_on_turn_timeout: false,
        soft_timeout_config: { timeout_seconds: 3, message: 'Hmm.', use_llm_generated_message: false, max_soft_timeouts_per_generation: 1 } },
      conversation: { max_duration_seconds: 600, client_events: ['audio', 'interruption', 'user_transcript', 'agent_response', 'client_tool_call', 'vad_score'] },
    },
    platform_settings: {
      auth: { enable_auth: true },
      privacy: { record_voice: false, retention_days: 1, delete_audio: true, delete_transcript_and_pii: true },
      overrides: { custom_llm_extra_body: true, conversation_config_override: { tts: { voice_id: true } } },
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
    companySlug: tenant.companySlug, authVersion: user.authVersion || 0, tokenId: user.tokenId })
    .setProtectedHeader({ alg: 'HS256' }).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(expires).sign(bridgeKey())
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
