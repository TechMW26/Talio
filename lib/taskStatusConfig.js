export const STATUS_COLOR_PALETTE = {
  gray: { column: 'bg-gray-100', header: 'text-gray-700', badge: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400' },
  blue: { column: 'bg-blue-50', header: 'text-blue-700', badge: 'bg-blue-100 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  purple: { column: 'bg-purple-50', header: 'text-purple-700', badge: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
  green: { column: 'bg-green-50', header: 'text-green-700', badge: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500' },
  orange: { column: 'bg-orange-50', header: 'text-orange-700', badge: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  red: { column: 'bg-red-50', header: 'text-red-700', badge: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500' },
  amber: { column: 'bg-amber-50', header: 'text-amber-700', badge: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  indigo: { column: 'bg-indigo-50', header: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' },
  pink: { column: 'bg-pink-50', header: 'text-pink-700', badge: 'bg-pink-100 text-pink-700 border-pink-200', dot: 'bg-pink-500' },
  teal: { column: 'bg-teal-50', header: 'text-teal-700', badge: 'bg-teal-100 text-teal-700 border-teal-200', dot: 'bg-teal-500' }
}
export const STATUS_COLOR_KEYS = Object.keys(STATUS_COLOR_PALETTE)
export function getStatusColorClasses(colorKey) {
  return STATUS_COLOR_PALETTE[colorKey] || STATUS_COLOR_PALETTE.gray
}
export const SYSTEM_STATUS_KEYS = ['todo', 'in-progress', 'review', 'completed', 'completed-pending-approval', 'rejected', 'blocked', 'archived']
export const DEFAULT_TASK_STATUSES = [
  { key: 'todo', label: 'To Do', color: 'gray', order: 0, isSystem: true },
  { key: 'in-progress', label: 'In Progress', color: 'blue', order: 1, isSystem: true },
  { key: 'review', label: 'Review', color: 'purple', order: 2, isSystem: true },
  { key: 'completed', label: 'Completed', color: 'green', order: 3, isSystem: true },
  { key: 'completed-pending-approval', label: 'Pending Approval', color: 'amber', order: 4, isSystem: true },
  { key: 'rejected', label: 'Rejected', color: 'red', order: 5, isSystem: true },
  { key: 'blocked', label: 'Blocked', color: 'orange', order: 6, isSystem: true },
  { key: 'archived', label: 'Archived', color: 'gray', order: 7, isSystem: true }
]
export function getProjectTaskStatuses(project) {
  const list = project?.taskStatuses
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_TASK_STATUSES
  return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}
export function isValidProjectStatusKey(project, statusKey) {
  return getProjectTaskStatuses(project).some(s => s.key === statusKey)
}
export function slugifyStatusKey(label, existingKeys = []) {
  const base = String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'status'
  if (!existingKeys.includes(base)) return base
  let i = 2
  while (existingKeys.includes(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}
// Allocate new keys only after reserving every saved/submitted key. Row order
// must never let a new status steal an existing status's task references.
export function normalizeTaskStatuses(incoming, existing = []) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > 100) fail('Provide between 1 and 100 task statuses')
  const submittedKeys = new Set()
  for (const row of incoming) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('Invalid task status')
    if (typeof row.label !== 'string' || !row.label.trim() || row.label.trim().length > 60) fail('Every status needs a label of 60 characters or fewer')
    if (row.key !== undefined && (typeof row.key !== 'string' || (row.key && !/^[a-z0-9-]{1,60}$/.test(row.key)))) fail('Invalid status key')
    if (row.key) {
      if (submittedKeys.has(row.key)) fail(`Duplicate status key "${row.key}"`)
      submittedKeys.add(row.key)
    }
  }
  for (const key of SYSTEM_STATUS_KEYS) if (!submittedKeys.has(key)) fail(`"${key}" is a built-in status and cannot be removed`)
  const reserved = new Set([...SYSTEM_STATUS_KEYS, ...existing.map(row => row.key), ...submittedKeys])
  return incoming.map((row, order) => {
    const label = row.label.trim()
    const key = row.key || slugifyStatusKey(label, [...reserved])
    reserved.add(key)
    return { key, label, color: STATUS_COLOR_KEYS.includes(row.color) ? row.color : 'gray', order, isSystem: SYSTEM_STATUS_KEYS.includes(key) }
  })
}
export const BOARD_SYSTEM_STATUS_KEYS = ['todo', 'in-progress', 'review', 'completed']
export function getBoardTaskStatuses(project) {
  const list = getProjectTaskStatuses(project).filter(s => !s.isSystem || BOARD_SYSTEM_STATUS_KEYS.includes(s.key))
  // Ensure "Completed" is always the last column, even for legacy boards.
  const completed = list.find(s => s.key === 'completed')
  return completed ? [...list.filter(s => s.key !== 'completed'), completed] : list
}
export function getHiddenSystemStatuses(project) {
  return getProjectTaskStatuses(project).filter(s => s.isSystem && !BOARD_SYSTEM_STATUS_KEYS.includes(s.key))
}
