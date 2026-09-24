import { isMiraDecisionRequest } from '@/lib/miraDecisionRouting'
import { matchMiraNavigation } from '@/lib/miraNavigation'

test.each(['Can you open my project?', 'Please invite Sahil', 'Update the task deadline', 'मेरा प्रोजेक्ट खोलो', 'Sahil ko hello bhej do', 'Meeting cancel kar do'])('routes %s to a compact decision', text => {
  expect(isMiraDecisionRequest(text)).toBe(true)
})
test.each(['Explain how to create projects', 'How do I send a message?', 'Do not delete it', 'What is the weather?'])('does not route explanatory or unrelated text: %s', text => {
  expect(isMiraDecisionRequest(text)).toBe(false)
})
test('continues missing details without reviving completed or unrelated actions', () => {
  const history = [{ role: 'user', content: 'Create a meeting' }, { role: 'assistant', content: 'What title and time should I use?' }]
  expect(isMiraDecisionRequest('Design review tomorrow at 10 AM', history)).toBe(true)
  expect(isMiraDecisionRequest('What is the weather?', history)).toBe(false)
  expect(isMiraDecisionRequest('Thanks', [{ role: 'user', content: 'Create a meeting' }, { role: 'assistant', content: 'Created. Anything else? Action outcome: {"success":true}' }])).toBe(false)
})
test('common Hinglish navigation requires no model call', () => {
  expect(matchMiraNavigation('projects kholo')).toBe('projects')
  expect(matchMiraNavigation('dashboard खोलो')).toBe('home')
})
