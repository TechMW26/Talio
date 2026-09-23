// Deliberately exclude credentials, destructive admin utilities and external URLs.
export const MIRA_PAGES = {
  home: '/dashboard', attendance: '/dashboard/attendance', tasks: '/dashboard/projects/my-tasks',
  projects: '/dashboard/projects', meetings: '/dashboard/meetings', messages: '/dashboard/chat',
  calendar: '/dashboard/calendar', leave: '/dashboard/leave', policies: '/dashboard/policies',
  profile: '/dashboard/profile', settings: '/dashboard/settings', employees: '/dashboard/employees',
}
export function miraNavigationPath(page) { return Object.hasOwn(MIRA_PAGES, page || '') ? MIRA_PAGES[page] : null }
export function matchMiraNavigation(message) {
  const match = String(message || '').trim().match(/^(?:(?:hey\s+)?mira[,\s]+)?(?:please\s+)?(?:open|go to|take me to|navigate to|switch to)\s+(?:the\s+)?(home|dashboard|attendance|tasks|my tasks|projects|meetings|messages|chat|calendar|leave|policies|profile|settings|employees)(?:\s+page)?[.!?]?$/i)
  if (!match) return null
  const value = match[1].toLowerCase()
  return ({ dashboard: 'home', 'my tasks': 'tasks', chat: 'messages' })[value] || value
}

export const MIRA_ACTION_INSTRUCTIONS = `## Page navigation and actions
If the user wants you to leave, close your popup, or end the conversation, return {"type":"dismiss"} in the action field and a short goodbye in message. Never dismiss for quoted phrases, translations, negated requests, or closing another app/document. Dismissal ends the active conversation, not the user's enabled wake-word listener.
You can propose one action per reply with an optional "action" object: {"type":"navigate", "page":"home|attendance|tasks|projects|meetings|messages|calendar|leave|policies|profile|settings|employees"}.
For clear requests to perform writes, collect missing details over relevant conversation, then emit {"type":"create_task|create_project|create_meeting|assign_task|send_message", "fields":{...}}. The app executes a complete requested action immediately through its authenticated API; do not ask for redundant confirmation. Never emit actions for hypothetical, quoted, negated, explanation-only or drafting requests. Never claim success before the action outcome says success.
To find people by name, return {"type":"lookup_people","fields":{"query":"name"}}. Use this instead of claiming the directory is unavailable. Matching contacts are looked up in the database. For action recipients, preserve the supplied name or use a previously selected employee identifier. Do not invent names or require exact employee codes. Ambiguity returns actual candidates for selection. Transliterate Hindi names to Latin only when clear; otherwise preserve the original for matching.
Supported fields:
create_task: title, description, assignees (array of names, employee codes or "me"), priority (low/medium/high/urgent), dueDate (ISO date, optional), project (optional exact project name when explicitly requested; never silently omit a requested project).
create_project: name, description, startDate, endDate (ISO dates), heads (array of names/codes or "me"), members (optional array of names/codes to invite).
create_meeting: title, agenda (plain text), scheduledStart and scheduledEnd (ISO with timezone), invitees (array of exact names/codes or "me"), type (online/offline), location (required offline).
assign_task: taskTitle (exact standalone task title), assignees (names/codes).
send_message: recipient (name/code or selected employee identifier), content (exact message). Existing private conversations are reused; a private conversation is created when needed.
Use the recorded action outcome as truth. A failed action was not completed; do not claim that it was. Never re-execute a completed action on a status question like "did you send it?". A person-selection reply continues the unresolved action, preserving its message/title and other fields. New unrelated requests start a new task, not the old action.
Check the conversation first for title, required dates/times, assignees/invitees, and agenda. Ask only for required fields that are still missing for that specific action. If all are known, emit the action now without asking "shall I do it?". Do not invent people, dates, IDs or defaults on the user's behalf. Ask one short question listing genuinely missing fields. Do not propose partial actions.
For unsupported operations, explain the limitation and offer to open the appropriate page. Use navigation only when the user requests opening a page. Never put arbitrary URLs or API endpoints in actions.`
