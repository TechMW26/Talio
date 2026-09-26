import { naturalMiraSpeech, miraSpeechSummary, miraOutputModeInstructions } from '@/lib/miraSpokenReply'
import { partialMiraMessage } from '@/lib/miraStream'

test('spoken output excludes URLs, email, code and formatting but keeps link labels', () => {
  const speech = naturalMiraSpeech('Read [the guide](https://example.com/a). Visit https://talio.in/test?q=one or www.example.com. Email user@example.com. ```js\nalert(1)\n``` **Done!**')
  expect(speech).toContain('the guide')
  expect(speech).toContain('Done!')
  expect(speech).not.toMatch(/https|example|talio|alert|```|\*\*/)
})

test('fallback speaks at most two sentences rather than a long message', () => {
  expect(miraSpeechSummary('The project is ready. Three tasks remain. Here is a detailed list. More details.')).toBe('The project is ready. Three tasks remain.')
  expect(miraSpeechSummary('word '.repeat(200))).toBe('')
  expect(miraSpeechSummary('The total is 3.5 hours. You are on track. Extra detail.')).toBe('The total is 3.5 hours. You are on track.')
})

test('voice uses the final visible answer while typed chat can contain full detail', () => {
  expect(miraOutputModeInstructions('voice')).toContain('Do not generate a separate speech answer')
  expect(miraOutputModeInstructions('voice')).toContain('after execution')
  expect(miraOutputModeInstructions('chat')).toContain('Do not force a short voice-style summary')
})

test('streams only the dedicated first speech field without leaking the detailed message', () => {
  const raw = '{"speech":"Your report is ready.","message":"See https://example.com/report for all results."}'
  expect(partialMiraMessage(raw, 'speech')).toBe('Your report is ready.')
  expect(partialMiraMessage(raw)).toBe('')
  expect(partialMiraMessage('{"message":"Detailed chat."}', 'speech')).toBe('')
})
