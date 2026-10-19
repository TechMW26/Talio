import { resolveMiraDesktopGoal, resolveMiraDesktopContinuation, isMiraDesktopAgreement } from '@/lib/miraDesktopGoal'

const request = 'Text Mansi on WhatsApp that I love you.'
const history = [{ role: 'user', content: request }, { role: 'assistant', content: 'Shall I send that to Mansi on WhatsApp?' }]
const musicRequest = 'Play Yellow on YouTube Music'
test.each(['Please proceed.', 'No. Please proceed.', 'Yes.'])('retains playback through the reported offer: %s', message => {
  const turns = [{ role: 'user', content: musicRequest }, { role: 'assistant', content: 'I can try opening YouTube Music and searching for Yellow on your laptop.' }]
  expect(resolveMiraDesktopGoal(message, { history: turns })).toContain(musicRequest)
})
test('recovers the original user task across repeated clarification, not the latest yes', () => {
  const turns = [
    { role: 'user', content: musicRequest },
    { role: 'assistant', content: 'I can try opening YouTube Music and searching for Yellow on your laptop.' },
    { role: 'user', content: 'No. Please proceed.' },
    { role: 'assistant', content: 'I need the actual request again—open YouTube Music and play Yellow, right?' },
  ]
  expect(resolveMiraDesktopGoal('Yes.', { history: turns })).toContain(musicRequest)
})
test.each(['No, do not proceed.', 'No. Please cancel.', 'Do not play it'])('negative replies never continue pending playback: %s', message => {
  expect(resolveMiraDesktopGoal(message, { history, taskBank: { tasks: [{ request: musicRequest, action: { type: 'desktop_task' }, status: 'pending' }] } })).toBeNull()
})
test.each(['नहीं खुला है, freshly open करो।', 'जी, कोशिश कीजिए।', 'It did not open, try again'])('app recovery preserves the launch instead of the retry phrase: %s', message => {
  const taskBank = { tasks: [{ request: 'Open YouTube Music', action: { type: 'desktop_task' }, status: 'blocked', uncertain: true }] }
  expect(resolveMiraDesktopGoal(message, { taskBank })).toBe('Open YouTube Music')
})
test('a fresh explicit command never carries an old messaging channel', () => {
  const goal = resolveMiraDesktopGoal('Send Alice an email in Gmail saying hello', { history })
  expect(goal).toBe('Send Alice an email in Gmail saying hello')
  expect(goal).not.toContain('WhatsApp')
})
test.each(['Yes, please.', 'Uh, yes, please.', 'Mm, yes.', 'हाँ', 'haan ji', 'Go ahead'])('retains the real task on spoken confirmation: %s', message => {
  expect(isMiraDesktopAgreement(message)).toBe(true)
  const goal = resolveMiraDesktopGoal(message, { history })
  expect(goal).toContain(request)
  expect(goal).toContain(`Current user instruction: ${message}`)
  expect(goal.length).toBeLessThanOrEqual(3000)
})
test('supports confirmation before voice has created a task bank', () => {
  expect(resolveMiraDesktopGoal('Yes, please.', { history, taskBank: { tasks: [] } })).toContain(request)
})
test('an unrelated completed task does not block a fresh confirmation', () => {
  expect(resolveMiraDesktopGoal('Yes.', { history, taskBank: { tasks: [{ request: 'Open Calculator', action: { type: 'desktop_task' }, status: 'completed' }] } })).toContain(request)
})
test.each(['जी', 'हाँ, भेज दो'])('Hindi confirmation retains the user-authored request: %s', message => {
  const turns = [history[0], { role: 'assistant', content: 'क्या मैं Mansi को WhatsApp पर यह संदेश भेज दूँ?' }]
  expect(resolveMiraDesktopGoal(message, { history: turns })).toContain(request)
})
test('a saved task retains recipient and message through a terse clarification', () => {
  const taskBank = { tasks: [{ request, action: { type: 'desktop_task' }, status: 'awaiting_details' }] }
  expect(resolveMiraDesktopGoal('M-A-N-S-I', { taskBank, history })).toContain(request)
})
test.each([
  [],
  [{ role: 'assistant', content: 'Should I send a message to Mansi on WhatsApp?' }],
  [history[0], { role: 'assistant', content: 'Sent the message. Anything else?' }],
  [history[0], { role: 'assistant', content: 'It may have sent. Retry?' }],
  [history[0], { role: 'assistant', content: 'Would you like to know about WhatsApp privacy?' }],
  [...history, { role: 'user', content: 'Cancel that task' }, { role: 'assistant', content: 'Anything else?' }],
  [...history, { role: 'user', content: 'What is the weather?' }, { role: 'assistant', content: 'Would you like more detail?' }],
].map(history => [history]))('does not revive missing, cancelled or ambiguous history', history => {
  expect(resolveMiraDesktopGoal('Yes, please.', { history })).toBeNull()
})
test.each([{ status: 'completed' }, { status: 'blocked', uncertain: true }])('never replays completed or uncertain work', state => {
  expect(resolveMiraDesktopGoal('Yes', { history, taskBank: { tasks: [{ request, action: { type: 'desktop_task' }, ...state }] } })).toBeNull()
})
test('a fresh launch replaces the old messaging goal', () => {
  expect(resolveMiraDesktopGoal('Open Calculator', { history })).toBe('Open Calculator')
})
test('bare acknowledgement is not an executable task, even if a model creates a draft for it', () => {
  expect(resolveMiraDesktopGoal('Yes', { taskBank: { tasks: [{ request: 'Yes', action: { type: 'desktop_task' } }] } })).toBeNull()
})

const desktopHistory = [{ request: musicRequest, result: 'Playing a different artist.', success: true }]
test.each([
  ['now play Yellow', 'followup'],
  ['That is wrong, play the Coldplay version', 'correction'],
  ['गलत गाना है, Coldplay वाला चलाओ', 'correction'],
  ['जाँच कर फिर कोशिश करो', 'retry'],
])('model-selected continuation keeps the actual task and correction: %s', (message, mode) => {
  const goal = resolveMiraDesktopContinuation(message, { mode, taskBank: { desktopHistory } })
  expect(goal).toContain(message)
  expect(goal).toContain(musicRequest)
  expect(goal).toContain('Inspect the current screen first')
  expect(goal).toContain('Do not replay completed steps')
  expect(goal.length).toBeLessThanOrEqual(3000)
})
test('uncertain write retries carry inspection constraints and are not blind replays', () => {
  const goal = resolveMiraDesktopContinuation('Check and retry', { mode: 'retry', taskBank: { tasks: [{ request, result: 'Input sent but not verified', action: { type: 'desktop_task' }, status: 'blocked', uncertain: true }] } })
  expect(goal).toContain(request)
  expect(goal).toContain('"uncertain":true')
  expect(goal).toContain('only if you verify it did not occur')
})
test.each(['new', undefined, 'cancel'])('does not inject historical targets for mode %s', mode => {
  expect(resolveMiraDesktopContinuation('Send Alice an email', { mode, taskBank: { desktopHistory } })).toBeNull()
})
test('bare yes after completion never replays desktop work', () => {
  expect(resolveMiraDesktopContinuation('Yes', { mode: 'retry', taskBank: { desktopHistory }, history: [{ role: 'assistant', content: 'Playing Yellow.' }] })).toBeNull()
})
test('explicit retry offer can resolve agreement to an inspect-first task', () => {
  expect(resolveMiraDesktopContinuation('Yes', { mode: 'retry', taskBank: { desktopHistory }, history: [{ role: 'assistant', content: 'Want me to check and try again?' }] })).toContain(musicRequest)
})
