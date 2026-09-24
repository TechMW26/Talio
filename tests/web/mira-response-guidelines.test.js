import { MIRA_RESPONSE_GUIDELINES } from '@/lib/miraResponseGuidelines'
import fs from 'fs'
import path from 'path'
import { MIRA_LANGUAGE_POLICY, buildMiraConversationPrompt } from '@/lib/miraLanguage'
import { buildWhiteboardPlanPrompt } from '@/lib/whiteboardAIPlan'

test('chat and generated board content share Roman-Hinglish policy with exact-data exceptions', () => {
  expect(MIRA_RESPONSE_GUIDELINES).toContain(MIRA_LANGUAGE_POLICY)
  expect(buildWhiteboardPlanPrompt('Ek plan banao', 'adaptive')).toContain(MIRA_LANGUAGE_POLICY)
  expect(MIRA_LANGUAGE_POLICY).toContain('Roman-script Hinglish')
  expect(MIRA_LANGUAGE_POLICY).toContain('English requests stay English')
  expect(MIRA_LANGUAGE_POLICY).toContain('Preserve exact quotations')
})

test('natural response guidance covers accuracy, tone, and punctuation without corrupting exact content', () => {
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Do not use em dashes')
  expect(MIRA_RESPONSE_GUIDELINES).not.toContain('\u2014')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Preserve exact user-provided quotations, code, identifiers, and URLs')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('unavailable data is not zero')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('without pretending to be human')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Use empty arrays for a simple answer')
})

test('chat system prompt includes guidance while preserving JSON and access rules', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/ai/mira-chat/route.js'), 'utf8')
  expect(route).toContain('${MIRA_RESPONSE_GUIDELINES}')
  expect(route).toContain('You MUST respond in valid JSON')
  expect(route).toContain("Do NOT share other employees' data")
  expect(route).not.toContain('You have internet access for up-to-date information')
  expect(route).not.toContain('Include 2-3 suggested follow-up questions')
})

test('action-first guidance delivers work, reuses known details and avoids redundant offers', () => {
  expect(MIRA_RESPONSE_GUIDELINES).toContain('produce the actual usable deliverable now')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Do not make the user request the same task twice')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Reuse details already provided')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('suggestedQuestions: []')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('report completion only after a successful execution result')
})

test('language switches are user-led and apply equally to speech and image acknowledgements', () => {
  expect(MIRA_LANGUAGE_POLICY).toContain('professional, natural English without Hindi words')
  expect(MIRA_LANGUAGE_POLICY).toContain('only when the user switches to Hindi/Hinglish')
  expect(MIRA_LANGUAGE_POLICY).toContain('switch back immediately')
  expect(MIRA_LANGUAGE_POLICY).toContain('most recent clear USER language')
  expect(MIRA_LANGUAGE_POLICY).toContain('spoken summaries, image-generation acknowledgements')
  expect(MIRA_LANGUAGE_POLICY).toContain('An explicit request for another language or script overrides')
  expect(MIRA_RESPONSE_GUIDELINES).not.toContain('main samajh gayi')
})

test.each([
  ['Create an image of a flying lion and an elephant chasing him.', 'Main bana rahi hoon.'],
  ['Mere liye ek image banao.', 'I can create that image.'],
  ['Please explain that in English.', 'Yeh raha jawab.'],
])('separates the latest language-bearing request from assistant history: %s', (message, previousReply) => {
  const prompt = buildMiraConversationPrompt(message, [{ role: 'assistant', content: previousReply }])
  expect(prompt).toContain('Previous conversation (context only):')
  expect(prompt).toContain(`MIRA: ${previousReply}`)
  expect(prompt.endsWith(`Latest user message:\n${message}`)).toBe(true)
})

test('neutral follow-ups preserve user history and new conversations have no inherited language', () => {
  const prompt = buildMiraConversationPrompt('OK', [{ role: 'user', content: 'Please use English.' }])
  expect(prompt).toContain('User: Please use English.')
  expect(buildMiraConversationPrompt('Hello')).toBe('Latest user message:\nHello')
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/ai/mira-chat/route.js'), 'utf8')
  expect(route).toContain('buildMiraConversationPrompt(userMessage, conversationHistory)')
})
