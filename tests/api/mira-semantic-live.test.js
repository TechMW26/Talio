// Opt-in provider acceptance. Synthetic conversations only; never executes tools.
import { miraDeepSeekRequest } from '@/lib/miraAgentGateway'
import { MIRA_DIRECT_VOICE_INSTRUCTIONS, MIRA_DIRECT_VOICE_TOOLS } from '@/lib/miraDirectVoice'
const liveTest = process.env.MIRA_SEMANTIC_LIVE === '1' ? test : test.skip
const cases = [
  ['bye Mire', 'close_mira'],
  ['बस मीरा, अब बातचीत बंद कर दो।', 'close_mira'],
  ['I need to go now, we can talk later.', 'close_mira'],
  ['Please do not close, I have another question.', 'not_close'],
  ['Translate "goodbye" into Hindi.', 'not_close'],
  ['Close Calculator, not our conversation.', 'ask_mira'],
  ['I made this drawing. Can you take a look and tell me what you think?', 'view_camera'],
  ['मीरा, मेरे हाथ में यह क्या है? ज़रा कैमरे से देखकर बताओ।', 'view_camera'],
  ['Turn your camera off but stay with me.', 'close_camera'],
  ['What materials would I need to start drawing?', 'not_camera'],
]
liveTest.each(cases)('live intent: %s → %s', async (text, expected) => {
  require('dotenv').config({ path: '.env.local', quiet: true })
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DeepSeek credential is not configured')
  const payload = miraDeepSeekRequest({ messages: [{ role: 'user', content: text }], tools: MIRA_DIRECT_VOICE_TOOLS }, /[\u0900-\u097f]/u.test(text) ? 'hi' : 'en')
  payload.messages[0].content += '\n' + MIRA_DIRECT_VOICE_INSTRUCTIONS
  const response = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, stream: false }), signal: AbortSignal.timeout(45000) })
  expect(response.status).toBe(200)
  const result = await response.json()
  const tool = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.name
  if (expected === 'not_close') expect(tool).not.toBe('close_mira')
  else if (expected === 'not_camera') expect(tool).not.toBe('view_camera')
  else expect(tool).toBe(expected)
}, 50000)
