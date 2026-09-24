import { miraAppPath } from './miraAppRoutes'
// Deliberately exclude credentials, destructive admin utilities and external URLs.
export const MIRA_PAGES = {
  home: '/dashboard', attendance: '/dashboard/attendance', tasks: '/dashboard/projects/my-tasks',
  projects: '/dashboard/projects', meetings: '/dashboard/meetings', messages: '/dashboard/chat',
  calendar: '/dashboard/calendar', leave: '/dashboard/leave', policies: '/dashboard/policies',
  profile: '/dashboard/profile', settings: '/dashboard/settings', employees: '/dashboard/employees',
  assets: '/dashboard/assets', documents: '/dashboard/documents', reports: '/dashboard/reports',
  board: '/dashboard/talioboard', helpdesk: '/dashboard/helpdesk', payroll: '/dashboard/payroll',
  announcements: '/dashboard/announcements', departments: '/dashboard/departments',
}
export function miraNavigationPath(page, id) {
  if (id == null && typeof page === 'string' && page.startsWith('/')) return miraAppPath(page)
  if (!Object.hasOwn(MIRA_PAGES, page || '')) return null
  if (page === 'tasks' && id != null) return /^[a-f\d]{24}$/i.test(String(id)) ? `${MIRA_PAGES.tasks}?task=${id}` : null
  if (id != null) return ['projects', 'meetings', 'employees', 'board'].includes(page) && /^[a-f\d]{24}$/i.test(String(id)) ? `${MIRA_PAGES[page]}/${id}` : null
  return MIRA_PAGES[page]
}

export function matchMiraProjectOpen(message) {
  const text = String(message || '').trim()
  const match = text.match(/^(?:please\s+)?(?:open|go to|navigate to)\s+(?:the\s+)?project\s+(.+?)\s*[.!]?$/i)
    || text.match(/^(?:please\s+)?(?:open|go to|navigate to)\s+(?:the\s+)?(.+?)\s+project(?:\s+page)?[.!]?$/i)
  if (!match) return null
  const query = match[1].replace(/^["']|["']$/g, '').trim()
  return query && query.length <= 120 ? { type: 'open_project', fields: { query } } : null
}
export function matchMiraItemOpen(message) {
  const text = String(message || '').trim()
  const prefix = text.match(/^(?:please\s+)?open\s+(?:the\s+)?(task|meeting)\s+(.+?)[.!]?$/i)
  const suffix = text.match(/^(?:please\s+)?open\s+(?:the\s+)?(.+?)\s+(task|meeting)[.!]?$/i)
  const local = text.match(/^(.+?)\s+(task|meeting)\s+(?:kholo|khol do|open karo|खोलो|खोल दो)[.!।]?$/i)
  const match = prefix || suffix || local
  if (!match) return null
  const kind = (prefix ? match[1] : match[2]).toLowerCase()
  const query = (prefix ? match[2] : match[1]).replace(/^["']|["']$/g, '').trim()
  return query && query.length <= 120 ? { type: `open_${kind}`, fields: { query } } : null
}
export function matchMiraNavigation(message) {
  const text = String(message || '').trim().replace(/[.!?।]+$/, '')
  const local = text.match(/^(?:please\s+)?(home|dashboard|attendance|tasks|projects|meetings|messages|calendar|leave|profile|assets|board)(?:\s+(?:page|ka page))?\s+(?:kholo|khol do|open karo|खोलो|खोल दो)$/i)
  if (local) return local[1].toLowerCase() === 'dashboard' ? 'home' : local[1].toLowerCase()
  const match = String(message || '').trim().match(/^(?:(?:hey\s+)?mira[,\s]+)?(?:please\s+)?(?:open|go to|take me to|navigate to|switch to)\s+(?:the\s+)?(home|dashboard|attendance|tasks|my tasks|projects|meetings|messages|chat|calendar|leave|policies|profile|settings|employees|assets|documents|reports|board|helpdesk|payroll|announcements|departments)(?:\s+page)?[.!?]?$/i)
  if (!match) return null
  const value = match[1].toLowerCase()
  return ({ dashboard: 'home', 'my tasks': 'tasks', chat: 'messages' })[value] || value
}

export const MIRA_ACTION_INSTRUCTIONS = `## Page navigation and actions
Create a dashboard Quick Note with {"type":"quick_note","fields":{"content":"the user's requested note text"}}. This appends to the existing device-local Quick Note without overwriting it. Do not claim Quick Notes are unsupported or merely direct the user to Quick Tools. Interpret obvious typos such as "wuick note" as "quick note". "Add a testing quick note" means content "testing". Ask for note text only when it is missing; never invent substantive content. Use this action only for a current explicit request, not quoted, hypothetical or negated requests.
For employee activity or screenshots on a date/time, use {"type":"view_productivity","fields":{"employee":"name or employee:ID","date":"YYYY-MM-DD","at":"optional ISO timestamp with explicit timezone offset"}}. Ask for a missing date or ambiguous employee/timezone. Use the user's current timezone for supplied local times. A time lookup returns captures within five minutes; date-only returns the day's gallery. Authorization is enforced server-side. Never invent screenshot observations, infer private traits or treat a snapshot as proof of continuous work. Do not use read_screen for historical employee activity.
For scrolling or clicking an existing navigation control on the current page, emit {"type":"ui_action","fields":{"operation":"scroll_up|scroll_down|click","target":"live executable control id, or exact visible control label"}}. Click supports internal dashboard links, tabs, explicitly registered navigation/form-opening controls and view/open/details/next/previous/back/close/cancel/list/pipeline/pending/completed/all controls. Business changes must use their supported server action, never arbitrary UI clicks. If a requested local tab cannot be matched by label, the client can inspect a fresh in-app snapshot and resolve the navigation control. Emit the requested target in ui_action rather than claiming you cannot find it. Do not invent a control or claim a click succeeded before execution.
To open an individual task or meeting, emit {"type":"open_task","fields":{"query":"task title or task:ID"}} or {"type":"open_meeting","fields":{"query":"meeting title or meeting:ID"}}. These are supported actions. Resolve names through the action, never claim you cannot open individual tasks or meetings. Ask the user to select if matches are ambiguous.
To open an individual project, emit {"type":"open_project","fields":{"query":"the exact project name or project:ID from a prior result"}}. The server resolves only accessible projects and asks the user to choose if ambiguous. Never confuse opening a named project with opening the projects list. Never invent IDs.
If the user wants you to leave, close your popup, or end the conversation, return {"type":"dismiss"} in the action field and a short goodbye in message. Never dismiss for quoted phrases, translations, negated requests, or closing another app/document. Dismissal ends the active conversation, not the user's enabled wake-word listener.
You can propose one action per reply with an optional "action" object: {"type":"navigate", "page":"home|attendance|tasks|projects|meetings|messages|calendar|leave|policies|profile|settings|employees"}.
For clear requests to perform writes, collect missing details over relevant conversation, then emit {"type":"create_task|create_project|create_meeting|assign_task|send_message", "fields":{...}}. The app executes a complete requested action immediately through its authenticated API; do not ask for redundant confirmation. Never emit actions for hypothetical, quoted, negated, explanation-only or drafting requests. Never claim success before the action outcome says success.
To find people by name, return {"type":"lookup_people","fields":{"query":"name"}}. Use this instead of claiming the directory is unavailable. Matching contacts are looked up in the database. For action recipients, preserve the supplied name or use a previously selected employee identifier. Do not invent names or require exact employee codes. Ambiguity returns actual candidates for selection. Transliterate Hindi names to Latin only when clear; otherwise preserve the original for matching.
Supported fields:
invite_project: query (project name or project:ID), invitees (names or chosen employee IDs). Adds members to an existing project, subject to project invitation permissions.
invite_meeting: query (meeting title or meeting:ID), invitees (names or chosen employee IDs). Adds attendees to an existing meeting, subject to organizer permissions.
create_task: title, description, assignees (array of names, employee codes or "me"), priority (low/medium/high/urgent), dueDate (ISO date, optional), project (optional exact project name when explicitly requested; never silently omit a requested project).
create_project: name, description, startDate, endDate (ISO dates), heads (array of names/codes or "me"), members (optional array of names/codes to invite).
create_meeting: title, agenda (plain text), scheduledStart and scheduledEnd (ISO with timezone), invitees (array of exact names/codes or "me"), type (online/offline), location (required offline).
assign_task: taskTitle (exact standalone task title), assignees (names/codes).
send_message: recipient (name/code or selected employee identifier), content (exact message). Existing private conversations are reused; a private conversation is created when needed.
Use the recorded action outcome as truth. A failed action was not completed; do not claim that it was. Never re-execute a completed action on a status question like "did you send it?". A person-selection reply continues the unresolved action, preserving its message/title and other fields. New unrelated requests start a new task, not the old action.
Check the conversation first for title, required dates/times, assignees/invitees, and agenda. Ask only for required fields that are still missing for that specific action. If all are known, emit the action now without asking "shall I do it?". Do not invent people, dates, IDs or defaults on the user's behalf. Ask one short question listing genuinely missing fields. Do not propose partial actions.
For unsupported operations, explain the limitation and offer to open the appropriate page. Use navigation only when the user requests opening a page. Never put arbitrary URLs or API endpoints in actions.`
