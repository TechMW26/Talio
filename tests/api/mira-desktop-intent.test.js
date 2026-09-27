import { miraDesktopIntent, miraOpenAppIntent, miraAppNameFollowup } from '@/lib/miraDesktopIntent'
import { advanceMiraTaskBank } from '@/lib/miraTaskBank'

test.each(['OpenTaleo', 'Open Teleo', 'Teleo app open करो', 'Talio खोलो', 'Open T A L I O', 'please open T-A-L-I-O', 'Can you open Talio?'])('normalizes Talio launch: %s', text => {
  expect(miraOpenAppIntent(text)).toBe('Talio')
})
test.each(['Open Chrom', 'Open Calclator', 'Open Whatsap'])('matches minor app name typos: %s', text => {
  expect(miraDesktopIntent(text)).not.toBeNull()
})
test.each(['Open Oracle Taleo', 'Open Slackware', 'Open Talio and send a message', 'do not open Teleo', 'Open unknownapp'])('does not guess or truncate a different request: %s', text => {
  expect(miraOpenAppIntent(text)).toBeNull()
})
test('spelling and agreement resolve only the latest app-opening clarification', () => {
  const history = [{ role: 'user', content: 'Open Teleo' }, { role: 'assistant', content: 'Did you mean Talio?' }]
  expect(miraAppNameFollowup('T A L I O', history)).toBe('Open Talio')
  expect(miraAppNameFollowup('चलिए।', history)).toBe('Open Talio')
  expect(miraAppNameFollowup('yes', [{ role: 'user', content: 'Text Sam on WhatsApp' }, history[1]])).toBeNull()
  expect(miraAppNameFollowup('yes', [history[0], { role: 'assistant', content: 'Opened Talio.' }])).toBeNull()
})
test('a Hinglish or joined launch replaces stale WhatsApp work', () => {
  const bank = { tasks: [{ request: 'Text Sam hi on WhatsApp', status: 'awaiting_details', action: { type: 'desktop_task' } }] }
  for (const text of ['OpenTaleo', 'Teleo app open करो']) expect(advanceMiraTaskBank(bank, text).tasks).toEqual([])
})

test.each(['text Mansi hi on whatsapp', 'Open WhatsApp', 'find Mansi on WhatsApp', 'WhatsApp खोलो', 'send hello on Telegram'])('routes external command: %s', text => {
  expect(miraDesktopIntent(text)).not.toBeNull()
})
test.each(['add a quick note', 'find Mansi in Talio', 'How do I open WhatsApp?', 'do not open WhatsApp', 'What is WhatsApp?'])('does not reroute: %s', text => {
  expect(miraDesktopIntent(text)).toBeNull()
})
test('only pure launch requests use the deterministic launch shortcut', () => {
  expect(miraOpenAppIntent('Open whatsapp')).toBe('WhatsApp')
  expect(miraOpenAppIntent('text Mansi hi on whatsapp')).toBeNull()
  expect(miraOpenAppIntent('Open WhatsApp and send hello')).toBeNull()
})
test('cancelled external app commands never restart desktop automation', () => {
  expect(miraDesktopIntent('Skip sending the WhatsApp message; check Priyanka instead.')).toBeNull()
  expect(miraDesktopIntent('Mira, cancel the WhatsApp task')).toBeNull()
})
