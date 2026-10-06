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

export const SYSTEM_STATUS_KEYS = [
  'todo',
  'in-progress',
  'review',
  'completed',
  'completed-pending-approval',
  'rejected',
  'blocked',
  'archived'
]

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
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'status'

  if (!existingKeys.includes(base)) return base
  let i = 2
  while (existingKeys.includes(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}