import { miraDesktopIntent, miraOpenAppIntent } from '@/lib/miraDesktopIntent'

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
