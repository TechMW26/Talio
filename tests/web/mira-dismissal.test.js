import { isMiraDismissal, buildMiraDismissalResponse } from '@/lib/miraDismissal'

test.each(['ठीक है, मेरा। Done, done. बस, ठीक है। Bye, bye.', 'Okay, done, thanks, bye Mira', 'बाय मीरा ठीक है'])('handles conversational signoff: %s', text => {
  expect(buildMiraDismissalResponse(text)).toMatchObject({ action: { type: 'dismiss' }, cards: [], suggestedQuestions: [] })
})
test.each(['done', 'ठीक है', 'bye but do not close', 'don’t close, bye', 'say "bye bye"', 'बस यह message भेजो bye', 'thanks for explaining goodbye'])('keeps non-dismissal intent open: %s', text => {
  expect(buildMiraDismissalResponse(text)).toBeNull()
})

test.each(['bye', 'Goodbye!', 'Mira, bye.', 'adiós', 'adios Mira', 'see you later', 'thanks, bye', 'please go away', 'close the popup', 'go back to standby', 'stop the conversation', 'thats all for now', 'अलविदा', 'मीरा अब जाओ', 'फिर मिलेंगे'])('recognizes dismissal: %s', text => {
  expect(isMiraDismissal(text)).toBe(true)
})
test.each(['translate goodbye into Hindi', 'write a goodbye email', 'do not close', 'close the project', 'bye is a word', 'tell my colleague bye', 'stop', 'stop listening for the wake word', 'adios means goodbye'])('does not dismiss unrelated requests: %s', text => {
  expect(isMiraDismissal(text)).toBe(false)
})
