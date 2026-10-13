import { createMiraWaitingFeedback, miraWaitingPhrase } from '@/lib/miraWaitingFeedback'

test.each(['', '...', 'Mira bye', 'One moment please', 'Please wait a moment', 'Stay silent for now', 'Can you hear me?', 'I am really depressed', 'एक मिनट रुकिए', 'Hi Mira'])('never fills a pause or inappropriate moment: %s', text => {
  expect(miraWaitingPhrase(text, 'en')).toBeNull()
})
test('waiting phrases fit the request and selected language without promising success or an ETA', () => {
  expect(miraWaitingPhrase('Check my tasks today', 'en')).toBe('[warm][fast] Let me check.')
  expect(miraWaitingPhrase('मेरे tasks दिखाओ', 'hi')).toBe('[warm][fast] देखती हूँ।')
  expect(miraWaitingPhrase('Draft an email please', 'en')).toBe('[warm][fast] Okay, one moment.')
  expect(miraWaitingPhrase('Why is the sky blue?', 'en')).toBe('[warm][fast] Let me think.')
})
let playback, ticket, feedback, onStart, live
beforeEach(() => {
  jest.useFakeTimers(); live = true
  ticket = { cancel: jest.fn(), result: Promise.resolve({ response: {} }) }
  playback = { prepare: jest.fn(() => ticket), speak: jest.fn(async (_, start) => start()) }
  onStart = jest.fn()
  feedback = createMiraWaitingFeedback({ playback, live: () => live, onStart })
})
afterEach(() => { feedback.stop(); jest.useRealTimers() })
test('delayed requests get one selected-voice cached phrase, never a repeating timer', async () => {
  feedback.start('Check my tasks today', 'en')
  expect(playback.prepare).toHaveBeenCalledWith('[warm][fast] Let me check.', { cache: true })
  await jest.advanceTimersByTimeAsync(699)
  expect(playback.speak).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(60000)
  expect(playback.speak).toHaveBeenCalledTimes(1)
  expect(onStart).toHaveBeenCalledTimes(1)
})
test('reply readiness or cancellation prevents late filler playback', async () => {
  let ready
  ticket.result = new Promise(resolve => { ready = resolve })
  feedback.start('Check my tasks today', 'en')
  await jest.advanceTimersByTimeAsync(800)
  feedback.stop()
  ready({ response: {} }); await Promise.resolve()
  expect(ticket.cancel).toHaveBeenCalled()
  expect(playback.speak).not.toHaveBeenCalled()
})
test('cooldown suppresses consecutive fillers and no speech starts after the call closes', async () => {
  feedback.start('Check my tasks today', 'en')
  await jest.advanceTimersByTimeAsync(800)
  feedback.start('Check my tasks tomorrow', 'en')
  expect(playback.prepare).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(12000)
  feedback.start('Check my tasks tomorrow', 'en'); live = false
  await jest.advanceTimersByTimeAsync(800)
  expect(playback.speak).toHaveBeenCalledTimes(1)
})
test('filler failures do not propagate to the reply', async () => {
  ticket.result = Promise.resolve({ error: new Error('unavailable') })
  feedback.start('Check my tasks today', 'en')
  await jest.advanceTimersByTimeAsync(800)
  expect(playback.speak).not.toHaveBeenCalled()
})
