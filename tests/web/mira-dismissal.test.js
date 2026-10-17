import { isMiraDismissal, buildMiraDismissalResponse } from '@/lib/miraDismissal'
test.each(['bye mire', 'Mire, close', 'बाय मिरे', 'Okay bye Mira, see you later', "Let's end this conversation", 'You can close now', 'आज के लिए इतना ही', 'मीरा बातचीत खत्म करो'])('closes for recognition variants and natural conversation endings: %s', text => {
  expect(isMiraDismissal(text)).toBe(true)
})
test.each(['Do not close Mire', 'Tell Mire bye', 'Translate "bye Mire"', 'end this conversation after sending the message'])('retains negation and quoted/incomplete-task safety: %s', text => {
  expect(isMiraDismissal(text)).toBe(false)
})

test.each(['Bye-bye Mira', 'बाय-बाय मीरा', 'Mira, stop', 'Stop Mira', 'Mira, switch off', 'Turn yourself off', 'Can you close the chat please?', 'Could you stop talking now?', 'मीरा बंद करो', 'अब बंद करो', 'कॉल काट दो', 'Mira, shut down', 'stop listening', 'close voice mode', 'call kaat do'])('recognizes complete voice off commands: %s', text => {
  expect(isMiraDismissal(text)).toBe(true)
})
test.each(['मीरा बस करो', 'बस करो', 'बस मीरा', 'Mira off', 'मीरा स्टॉप', 'Bye Mira and thank you'])('keeps off intent when peeling conversational boundary words: %s', text => {
  expect(isMiraDismissal(text)).toBe(true)
})
test.each(['do not switch off', 'Can you close the project?', 'tell Sahil to stop talking', 'write "bye-bye Mira"', 'switch off the lights', 'stop listening after you send it'])('does not confuse quoted or unrelated commands with voice shutdown: %s', text => {
  expect(isMiraDismissal(text)).toBe(false)
})

test.each(['ठीक है, मेरा। Done, done. बस, ठीक है। Bye, bye.', 'Okay, done, thanks, bye Mira', 'बाय मीरा ठीक है'])('handles conversational signoff: %s', text => {
  expect(buildMiraDismissalResponse(text)).toMatchObject({ action: { type: 'dismiss' }, cards: [], suggestedQuestions: [] })
})
test.each(['done', 'ठीक है', 'bye but do not close', 'don’t close, bye', 'say "bye bye"', 'बस यह message भेजो bye', 'thanks for explaining goodbye'])('keeps non-dismissal intent open: %s', text => {
  expect(buildMiraDismissalResponse(text)).toBeNull()
})

test.each(['bye', 'Goodbye!', 'Mira, bye.', 'adiós', 'adios Mira', 'see you later', 'thanks, bye', 'please go away', 'close the popup', 'go back to standby', 'stop the conversation', 'thats all for now', 'अलविदा', 'मीरा अब जाओ', 'फिर मिलेंगे', 'End the call', 'Hang up', 'Mira, good night', 'call band karo', 'मीरा कॉल बंद करो'])('recognizes dismissal: %s', text => {
  expect(isMiraDismissal(text)).toBe(true)
})
test.each(['translate goodbye into Hindi', 'write a goodbye email', 'do not close', 'close the project', 'bye is a word', 'tell my colleague bye', 'stop', 'stop listening for the wake word', 'adios means goodbye', 'end the call after sending the report', 'do not end the call'])('does not dismiss unrelated requests: %s', text => {
  expect(isMiraDismissal(text)).toBe(false)
})
