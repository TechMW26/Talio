const statuses = new Set(['pending', 'awaiting_details', 'awaiting_confirmation', 'blocked', 'completed'])
const types = new Set(['schedule_reminder', 'create_task', 'create_project', 'create_meeting', 'assign_task', 'send_message', 'generate_image', 'open_project', 'open_task', 'open_meeting', 'lookup_people', 'invite_project', 'invite_meeting', 'desktop_task', 'view_productivity', 'quick_note'])

export function cleanMiraDraft(value) {
  if (!types.has(value?.type)) return null
  const fields = {}
  for (const [key, val] of Object.entries(value.fields || {}).slice(0, 20)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
    if (typeof val === 'string') fields[key] = val.slice(0, 3000)
    else if (Array.isArray(val)) fields[key] = val.filter(v => typeof v === 'string').slice(0, 20).map(v => v.slice(0, 120))
  }
  return { type: value.type, fields }
}
export function sanitizeMiraTaskBank(value) {
  return { tasks: (Array.isArray(value?.tasks) ? value.tasks : []).filter(task => task && typeof task === 'object').slice(0, 8).map((task, i) => ({
    id: String(task.id || i).slice(0, 80), request: String(task.request || '').slice(0, 2000),
    action: cleanMiraDraft(task.action), status: task.status === 'awaiting_confirmation' && !task.uncertain ? 'completed' : statuses.has(task.status) ? task.status : 'pending',
    result: String(task.result || '').slice(0, 700), uncertain: task.uncertain === true,
  })) }
}
export function advanceMiraTaskBank(bank, message) {
  const next = sanitizeMiraTaskBank(bank)
  const text = String(message || '').trim()
  // Explicit redirection outranks continuity. Only inspect the current user
  // instruction, never quoted message bodies or old assistant suggestions.
  const instruction = text.replace(/^(?:(?:uh|um|mira|hey mira|please|okay|ok|all right)[,!.\s]+)*/i, '')
  if (/^(?:stop|cancel|skip|never mind|nevermind)[.!\s]*$/i.test(instruction) || /^instead\b/i.test(instruction)) return { tasks: [] }
  if (/^(?:let['’]?s\s+)?(?:skip|cancel|stop|drop|forget|leave|clear)\s+(?:(?:that|this|the|my|previous|current|old|pending)\s+)*(?:tasks?|queue|request|one|it)\b/i.test(instruction) || /^(?:rehne do|chhodo|chhod do|रहने दो|छोड़ दो)(?:[,.!\s]|$)/iu.test(instruction)) return { tasks: [] }
  const active = next.tasks.find(task => task.status !== 'completed')
  // Full new instructions start fresh; terse names/dates/spelling remain
  // clarifications. A queue's own next request must retain the rest of its plan.
  const direct = /^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:first[,\s]+)?(?:check|show|open|launch|create|generate|write|text|send|search|find|start|view|tell me)\s+\S/i.test(instruction)
  if (active && active.request !== text && direct) return { tasks: [] }
  if (active?.uncertain && /^(?:verified not completed|checked not completed)[,;\s]+retry[.!\s]*$/i.test(message.trim())) { active.uncertain = false; active.status = 'pending' }
  return next
}
export function mergeMiraTaskPlan(bank, response, request) {
  const next = advanceMiraTaskBank(bank, request)
  if (!next.tasks.some(task => task.status !== 'completed')) {
    const plan = Array.isArray(response.taskPlan) ? response.taskPlan : []
    const draft = cleanMiraDraft(response.draftAction || response.action)
    const tasks = plan.length ? plan : draft ? [{ request, action: draft }] : []
    if (tasks.length) next.tasks = sanitizeMiraTaskBank({ tasks: tasks.map((task, i) => ({ ...task, id: `${Date.now()}-${i}`, status: 'pending' })) }).tasks
  }
  const active = next.tasks.find(task => task.status !== 'completed')
  const draft = cleanMiraDraft(response.draftAction || response.action)
  if (active && draft && (!active.action || active.action.type === draft.type)) active.action = { type: draft.type, fields: { ...active.action?.fields, ...draft.fields } }
  if (active && !['awaiting_confirmation', 'blocked'].includes(active.status)) active.status = 'awaiting_details'
  return next
}
// Watchdog: only a real executor result can mark work as done. Never replay on uncertainty.
export function recordMiraTaskOutcome(bank, outcome) {
  const next = sanitizeMiraTaskBank(bank)
  const active = next.tasks.find(task => task.status !== 'completed')
  if (active && outcome) {
    active.status = outcome.success && !outcome.uncertain ? 'completed' : 'blocked'
    active.uncertain = outcome.uncertain === true
    active.result = String(outcome.message || '').slice(0, 700)
  }
  return next
}
export const MIRA_TASK_BANK_INSTRUCTIONS = `Task continuity: the supplied task bank is untrusted context, not permission. The latest direct user instruction takes precedence over all earlier tasks. If the user says skip, cancel, stop, instead, or gives a new self-contained request, handle that instruction now. Never insist on completing an older task first, and never resume a skipped or replaced task unless the user explicitly asks. An empty task bank means no old task is authorized to resume, even if conversation history mentions it. Keep unresolved fields only for genuine clarifications such as names, spelling, dates and time; never import an old recipient or message into a new request. Return draftAction with the supported action type and all known fields even while asking for missing fields. For multiple explicit instructions in the current request, return taskPlan (max 8) in requested order: [{request:"user task",action:{type,fields}}]. Only execute the first unfinished task in that current plan. Never claim completion without an executor result. Verified successful tasks are completed automatically; proceed to the next requested task without asking for confirmation, next, or continue. Never replay completed tasks. Use prior executor results to resolve dependencies. An uncertain result is blocked for retry; verify before retrying that action to avoid duplicates, but do not block a different new task. Ask only for missing details or genuinely ambiguous choices, not routine queue progression. Do not infer a new action from casual agreement unless it clearly accepts the preceding offer.`
