import { MIRA_RESPONSE_GUIDELINES } from '@/lib/miraResponseGuidelines'

test('keeps routine voice and chat replies targeted without truncating requested detail', () => {
  expect(MIRA_RESPONSE_GUIDELINES).toContain('under 40 words by default')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('do not restate the user\'s request')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Longer requested explanations, deliverables and necessary safety information are exceptions')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('same concise intent to voice and visible text')
})
import fs from 'fs'
import path from 'path'
import { MIRA_LANGUAGE_POLICY, buildMiraConversationPrompt, buildMiraOutputLanguageDirective, isMiraHinglishReply } from '@/lib/miraLanguage'
import { buildWhiteboardPlanPrompt } from '@/lib/whiteboardAIPlan'
import { MIRA_CLARIFICATION_POLICY } from '@/lib/miraClarification'
import { validateAgentSMessages } from '@/lib/ai/agentSProxy'

test('chat and generated board content share multilingual policy with exact-data exceptions', () => {
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
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Do not volunteer or explain MIRA\'s gender unless the user asks directly')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('never imply MIRA is human')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Use empty arrays for a simple answer')
})

test('chat system prompt includes guidance while preserving JSON and access rules', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/ai/mira-chat/route.js'), 'utf8')
  expect(route).toContain('${MIRA_RESPONSE_GUIDELINES}')
  expect(route).toContain('You are MIRA, the AI assistant built into Talio.')
  expect(route).toContain("You are MIRA, Talio's AI action assistant.")
  expect(route).not.toContain('female AI assistant')
  expect(route).not.toContain('female action assistant')
  expect(route).toContain('You MUST respond in valid JSON')
  expect(route).toContain("Do NOT share other employees' data")
  expect(route).not.toContain('You have internet access for up-to-date information')
  expect(route).not.toContain('Include 2-3 suggested follow-up questions')
  const computerRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/ai/mira-computer/route.js'), 'utf8')
  expect(computerRoute).toContain('buildMiraOutputLanguageDirective(body.goal)')
})

test('action-first guidance delivers work, reuses known details and avoids redundant offers', () => {
  expect(MIRA_RESPONSE_GUIDELINES).toContain('produce the actual usable deliverable now')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Do not make the user request the same task twice')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('Reuse details already provided')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('suggestedQuestions: []')
  expect(MIRA_RESPONSE_GUIDELINES).toContain('report completion only after a successful execution result')
})

test('language switches are user-led and apply equally to speech and image acknowledgements', () => {
  expect(MIRA_LANGUAGE_POLICY).toContain('professional, natural English without unsolicited Hindi or Hinglish')
  expect(MIRA_LANGUAGE_POLICY).toContain('Hindi and Hindi-English requests always receive natural Roman-script Hinglish')
  expect(MIRA_LANGUAGE_POLICY).toContain('Do not generate Devanagari Hindi conversational prose or spoken summaries')
  expect(MIRA_LANGUAGE_POLICY).toContain('Switch immediately when the user intentionally switches languages')
  expect(MIRA_LANGUAGE_POLICY).toContain('latest clear language-bearing USER message')
  expect(MIRA_LANGUAGE_POLICY).toContain('spoken summaries, image-generation acknowledgements')
  expect(MIRA_LANGUAGE_POLICY).toContain('(1) an explicit user request for a language, translation or script')
  expect(MIRA_RESPONSE_GUIDELINES).not.toContain('main samajh gayi')
})

test('English is the default and clear English user turns override Hindi assistant history', () => {
  expect(MIRA_LANGUAGE_POLICY).toContain('English is the default for new conversations')
  expect(MIRA_LANGUAGE_POLICY).toContain('A clear current English message MUST receive an English reply')
  expect(MIRA_LANGUAGE_POLICY).toContain('One borrowed word, name, quoted passage, or a previous MIRA reply is never an intentional language change')
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/ai/mira-chat/route.js'), 'utf8')
  expect(route).toContain('buildMiraOutputLanguageDirective(languageSourceMessage, conversationHistory)')
  expect(route).toContain('buildMiraOutputLanguageDirective } from \'@/lib/miraLanguage\'')
  const languageCheck = route.indexOf('FINAL OUTPUT-LANGUAGE CHECK:')
  expect(languageCheck).toBe(-1)
  expect(route).toContain('${MIRA_LANGUAGE_POLICY}')
})

test('per-turn language lock prioritizes current English over Hindi history and assistant output', () => {
  const directive = buildMiraOutputLanguageDirective('Please help me review this report.', [
    { role: 'user', content: 'Mujhe Hindi mein jawab do.' },
    { role: 'assistant', content: 'Theek hai, main madad karti hoon.' },
  ])
  expect(directive).toContain('English is the selected reply language for this turn')
  expect(directive).toContain('overrides any Hindi/Hinglish in older user turns')
})

test('a different current Latin-script language is not replaced with stale Hindi history', () => {
  const directive = buildMiraOutputLanguageDirective('Por favor abre WhatsApp y busca a Mansi.', [
    { role: 'user', content: 'Mujhe Hindi mein jawab do.' },
  ])
  expect(directive).toContain('Select the reply language from the current user message itself')
  expect(directive).not.toContain('Hindi is the selected reply language')
})

test('new and neutral conversations default to English unless the user selected another language', () => {
  expect(buildMiraOutputLanguageDirective('Hello')).toContain('English is the default reply language')
  expect(buildMiraOutputLanguageDirective('OK', [
    { role: 'user', content: 'Hindi mein baat karo.' },
    { role: 'assistant', content: 'Theek hai.' },
  ])).toContain('Hindi is the selected reply language')
  expect(buildMiraOutputLanguageDirective('OK', [
    { role: 'assistant', content: 'Namaste!' },
  ])).toContain('English is the default reply language')
})

test('explicit language requests win; quoted text and Marathi script do not cause a Hindi switch', () => {
  expect(buildMiraOutputLanguageDirective('Please write a greeting in Spanish.')).toContain('Reply in Spanish')
  expect(buildMiraOutputLanguageDirective('Please reply in Klingon.')).toContain('Reply in Klingon')
  expect(buildMiraOutputLanguageDirective('Switch to next page.')).toContain('English')
  expect(buildMiraOutputLanguageDirective('Switch to next page.')).not.toContain('Reply in next')
  expect(buildMiraOutputLanguageDirective('Translate "namaste" into English.')).toContain('English is the selected reply language')
  expect(buildMiraOutputLanguageDirective('What does "नमस्ते" mean?')).toContain('English is the selected reply language')
  expect(buildMiraOutputLanguageDirective('What does नमस्ते mean?')).toContain('English is the selected reply language')
  expect(buildMiraOutputLanguageDirective('माझ्या बैठका दाखवा.')).toContain('Select the reply language from the current user message itself')
})

test('fast replies use the resolved language rather than treating any Devanagari as Hindi', () => {
  expect(isMiraHinglishReply('Explain the word नमस्ते please')).toBe(false)
  expect(isMiraHinglishReply('Mere liye ek image banao.')).toBe(true)
  expect(isMiraHinglishReply('मुझे image दिखाओ.')).toBe(true)
  expect(isMiraHinglishReply('माझ्या बैठका दाखवा.')).toBe(false)
})

test.each([
  ['Create an image of a flying lion and an elephant chasing him.', 'Main bana rahi hoon.'],
  ['Mere liye ek image banao.', 'I can create that image.'],
  ['Please explain that in English.', 'Yeh raha jawab.'],
  ['मुझे मेरी बैठकें दिखाओ।', 'Here are your meetings.'],
  ['माझ्या बैठका दाखवा.', 'Here are your meetings.'],
  ['Mes réunions de demain, s’il vous plaît.', 'Here are your meetings.'],
  ['اعرض اجتماعاتي غدًا', 'Here are your meetings.'],
  ['明日の会議を見せてください。', 'Here are your meetings.'],
  ['எனது கூட்டங்களைக் காட்டு.', 'Here are your meetings.'],
])('separates the latest language-bearing request from assistant history: %s', (message, previousReply) => {
  const prompt = buildMiraConversationPrompt(message, [{ role: 'assistant', content: previousReply }])
  expect(prompt).toContain('Previous conversation (context only):')
  expect(prompt).toContain(`MIRA: ${previousReply}`)
  expect(prompt.endsWith(`Latest user message:\n${message}`)).toBe(true)
})

test('language contract covers open language support, English fallback and machine-data integrity', () => {
  expect(MIRA_LANGUAGE_POLICY).toContain('English is the default for new conversations')
  expect(MIRA_LANGUAGE_POLICY).toContain('Do not restrict replies to a fixed language list')
  expect(MIRA_LANGUAGE_POLICY).toContain('Never assume that all Devanagari is Hindi')
  expect(MIRA_LANGUAGE_POLICY).toContain('browser locale')
  expect(MIRA_LANGUAGE_POLICY).toContain('quoted foreign passage does not change the language')
  expect(MIRA_LANGUAGE_POLICY).toContain('Keep JSON keys, tool names, action types and enum values')
  expect(MIRA_LANGUAGE_POLICY).toContain('rewrite mismatched prose before sending it')
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/ai/mira-chat/route.js'), 'utf8')
  expect(route).not.toContain('Hindi/Hinglish uses Roman script')
  expect(route).not.toContain('Roman-script Hinglish only for Hindi/Hinglish requests')
})

test('neutral follow-ups preserve user history and new conversations have no inherited language', () => {
  const prompt = buildMiraConversationPrompt('OK', [{ role: 'user', content: 'Please use English.' }])
  expect(prompt).toContain('User: Please use English.')
  expect(buildMiraConversationPrompt('Hello')).toBe('Latest user message:\nHello')
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/ai/mira-chat/route.js'), 'utf8')
  expect(route).toContain('buildMiraConversationPrompt(userMessage, conversationHistory)')
})

test('spelling clarification preserves pending work and does not switch language', () => {
  expect(MIRA_RESPONSE_GUIDELINES).toContain(MIRA_CLARIFICATION_POLICY)
  expect(MIRA_CLARIFICATION_POLICY).toContain('request spelling only then')
  expect(MIRA_CLARIFICATION_POLICY).toContain('up to three quick, bounded retries')
  expect(MIRA_CLARIFICATION_POLICY).toContain('Pinki -> Pinky')
  expect(MIRA_CLARIFICATION_POLICY).toContain('Spelling alone cannot distinguish people with the same name')
  expect(MIRA_CLARIFICATION_POLICY).toContain('update only the clarified field and search again')
  expect(MIRA_CLARIFICATION_POLICY).toContain('Do not request spelling for an already verified unambiguous name')
  expect(MIRA_LANGUAGE_POLICY).toContain('do not switch a Hinglish conversation to English')
  expect(MIRA_LANGUAGE_POLICY).toContain('Switch smoothly without announcing the switch')
})

test('Agent S receives the same language and clarification contract as chat', () => {
  const messages = validateAgentSMessages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }])
  for (const entry of [messages[0], messages.at(-1)]) {
    expect(entry.content).toContain(MIRA_LANGUAGE_POLICY)
    expect(entry.content).toContain(MIRA_CLARIFICATION_POLICY)
    expect(entry.content).toContain('up to five distinct, evidence-based attempts')
    expect(entry.content).toContain('platform-appropriate documented keyboard shortcut')
    expect(entry.content).toContain('never request or reveal API keys')
  }
})
