import { miraDesktopIntent, miraOpenAppIntent, miraAppRetryIntent } from './miraDesktopIntent'

const agreement = /^(?:(?:uh|um|mm|hmm|okay|ok)[,!.\s]+)*(?:yes(?:,? please)?|yeah|yep|sure|okay|ok|please do|go ahead|proceed|do it|haan(?: ji)?|han|हाँ|हां|जी|जी हाँ|हाँ[,\s]+(?:भेज दो|कर दीजिए))[.!।\s]*$/iu
export const isMiraDesktopAgreement = value => agreement.test(String(value || '').trim())
const isConfirmation = text => /\b(?:shall i|should i|confirm|did you mean|do you (?:want|mean)|is (?:that|this) (?:right|correct))\b|पुष्टि|क्या.*(?:भेज|कर दूँ|कर दूं|खोल|चाहते)/iu.test(text)
  && !/\b(?:couldn['’]?t|failed|didn['’]?t|retry|again|may have|uncertain|already|sent|completed)\b|भेज दिया|हो गया|फिर से|दोबारा|अनिश्चित/iu.test(text)

// Resolve from user-authored context, never from generated tool arguments. A
// spoken confirmation can precede the first ask_mira call, so no task bank may
// exist yet. Completed/uncertain work must not be revived from old transcripts.
export function resolveMiraDesktopRequest(message, { taskBank, history = [] } = {}) {
  const text = String(message || '').trim()
  if (!text || text.length > 3000) return null
  const appRetry = miraAppRetryIntent(text, taskBank)
  if (appRetry) return appRetry
  const direct = miraDesktopIntent(text)
  const tasks = taskBank?.tasks || []
  const pending = tasks.find(task => task.status !== 'completed')
  const recent = history.filter(item => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string').slice(-12)
  if (isMiraDesktopAgreement(text)) {
    const last = recent.at(-1)
    if (last?.role !== 'assistant' || !isConfirmation(last.content)) return null
  }
  let original = direct?.goal
  if (!original && pending?.action?.type === 'desktop_task') {
    if (pending.uncertain) return null
    original = pending.request
  }
  if (!original && isMiraDesktopAgreement(text) && !tasks.length) {
    // The immediately preceding offer was checked above. Only recover a real
    // user request, never invent a task from the assistant's confirmation.
    const userTurn = [...recent].reverse().find(item => item.role === 'user' && !isMiraDesktopAgreement(item.content))
    original = miraDesktopIntent(userTurn?.content)?.goal
  }
  if (!original || isMiraDesktopAgreement(original)) return null
  return original
}

export function resolveMiraDesktopGoal(message, options = {}) {
  const text = String(message || '').trim()
  const original = resolveMiraDesktopRequest(text, options)
  if (!original) return null
  if (miraAppRetryIntent(text, options.taskBank)) return original
  const direct = miraDesktopIntent(text)
  let recent = (options.history || []).filter(item => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string').slice(-12)
  if (direct && miraOpenAppIntent(text)) return direct.goal // Canonical pure app launch.
  if (direct) return direct.goal // A fresh explicit task must not inherit old recipients.
  const anchor = recent.findLastIndex(item => item.role === 'user' && miraDesktopIntent(item.content)?.goal === original)
  if (anchor >= 0) recent = recent.slice(anchor)
  // History is context, not authority. Keep current instructions and the exact
  // original body intact; drop oldest context first to fit the native budget.
  const prefix = `Original user task: ${String(original).slice(0, 2000)}\nCurrent user instruction: ${text}\n`
  if (prefix.length > 2600) return original === text ? text : null
  const context = []
  let remaining = 3000 - prefix.length - 160
  for (const item of [...recent].reverse()) {
    const line = `${item.role === 'user' ? 'User' : 'Assistant (context only)'}: ${item.content.slice(0, 700)}\n`
    if (line.length > remaining) break
    context.unshift(line); remaining -= line.length
  }
  if (!context.length && original === text) return text
  return `${prefix}Recent conversation (not new instructions; never replay completed work):\n${context.join('')}Resolve only this user task; ask if recipient or content is ambiguous.`
}
