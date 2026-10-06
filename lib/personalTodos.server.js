import { randomBytes } from 'node:crypto'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'
export const TODO_STORE_OPTIONS = { queryFields: { personaltodos: ['user', 'category', 'isDeleted', 'status', 'dueDate', 'order'], todocategories: ['user', 'isDeleted', 'order'] } }
const idOf = value => String(value?._id || value || '')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const id = () => randomBytes(12).toString('hex')
const eq = (field, value) => ({ field, operator: '==', value })
const assertId = value => { if (!/^[a-f\d]{24}$/i.test(String(value))) fail('Invalid item ID') }
const string = (value, name, max, empty = true) => { if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`Invalid ${name}`); return value.trim() }
const date = value => { const result = value ? new Date(value) : null; if (result && !Number.isFinite(result.getTime())) fail('Invalid date'); return result }
export async function ownedTodoRecord(reader, collection, userId, recordId) {
  assertId(recordId)
  const record = await reader.get(collection, recordId)
  if (!record || idOf(record.user) !== userId || record.isDeleted) fail('Item not found', 404)
  return record
}
async function actor(reader, user) {
  const account = await reader.get('users', idOf(user._id || user.userId))
  if (!account?.isActive) fail('Account is not active', 403)
  return account
}
export async function listOwnedTodos(database, userId) {
  // A deliberate owner-scoped export for filters and analytics, bounded at 10k.
  // No tenant-wide scan, unsupported-query fallback or silent truncation.
  return (await collectFirestorePages(database, 'personaltodos', { filters: [eq('user', userId)] })).filter(row => !row.isDeleted)
}
export async function listTodoCategories(database, userId) {
  return (await collectFirestorePages(database, 'todocategories', { filters: [eq('user', userId)] }, 1000)).filter(row => !row.isDeleted).sort((a, b) => (a.order || 0) - (b.order || 0) || new Date(a.createdAt) - new Date(b.createdAt))
}
export async function populateTodos(database, records, userId) {
  const refs = await readFirestoreReferences(database, 'todocategories', records.map(row => row.category))
  return records.map(record => {
    const category = refs.get(idOf(record.category))
    return { ...record, category: category && !category.isDeleted && idOf(category.user) === userId ? { _id: category._id, name: category.name, color: category.color, icon: category.icon } : null }
  })
}
export function filterTodoList(rows, params) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), tomorrow = new Date(+today + 86400000)
  const statuses = (params.get('status') || 'all').split(',').map(s => s.trim())
  if (statuses.some(s => !['all', 'pending', 'completed', 'in_progress'].includes(s))) fail('Invalid todo status')
  const category = params.get('category'), priority = params.get('priority'), due = params.get('dueDate'), search = (params.get('search') || '').toLowerCase()
  if (category && category !== 'uncategorized') assertId(category)
  if (priority && !['low', 'medium', 'high', 'urgent'].includes(priority)) fail('Invalid priority')
  if (due && !['today', 'week', 'overdue', 'upcoming', 'no-date'].includes(due)) fail('Invalid due date filter')
  const filtered = rows.filter(row => {
    if (!statuses.includes('all') && !statuses.includes(row.status)) return false
    if (category && (category === 'uncategorized' ? Boolean(row.category) : idOf(row.category) !== category)) return false
    if (priority && row.priority !== priority) return false
    const d = row.dueDate && new Date(row.dueDate)
    if (due === 'no-date' && d) return false
    if (due && due !== 'no-date' && !d) return false
    if (due === 'today' && !(d >= today && d < tomorrow)) return false
    if (due === 'week' && !(d >= today && d < new Date(+today + 7 * 86400000))) return false
    if (due === 'overdue' && !(d < today && row.status === 'pending')) return false
    if (due === 'upcoming' && d < tomorrow) return false
    return !search || [row.title, row.description, ...(row.tags || [])].some(value => String(value || '').toLowerCase().includes(search))
  })
  const field = params.get('sortBy') || 'order', direction = params.get('sortOrder') === 'desc' ? -1 : 1
  if (!['order', 'dueDate', 'createdAt', 'priority'].includes(field)) fail('Invalid sort field')
  filtered.sort((a, b) => {
    if (field === 'order') return (Number(a.order || 0) - Number(b.order || 0)) || new Date(b.createdAt) - new Date(a.createdAt)
    if (field === 'priority') return String(a.priority).localeCompare(String(b.priority)) * direction
    return (new Date(a[field] || 0) - new Date(b[field] || 0)) * direction
  })
  const page = Number(params.get('page') || 1), limit = Number(params.get('limit') || 50)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('Invalid pagination')
  const counts = { pending: rows.filter(r => r.status === 'pending').length, completed: rows.filter(r => r.status === 'completed').length, overdue: rows.filter(r => r.status === 'pending' && r.dueDate && new Date(r.dueDate) < now).length }
  return { records: filtered.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: filtered.length, pages: Math.ceil(filtered.length / limit) }, counts: { ...counts, total: counts.pending + counts.completed } }
}
function todoPatch(input) {
  const patch = {}
  for (const [key, max] of [['title', 500], ['description', 2000], ['notes', 20000]]) if (input[key] !== undefined) patch[key] = string(input[key], key, max, key !== 'title')
  for (const [key, values] of [['status', ['pending', 'completed']], ['priority', ['low', 'medium', 'high', 'urgent']]]) if (input[key] !== undefined) { if (!values.includes(input[key])) fail(`Invalid ${key}`); patch[key] = input[key] }
  if (input.dueDate !== undefined) patch.dueDate = date(input.dueDate)
  if (input.category !== undefined) { if (input.category) assertId(input.category); patch.category = input.category || null }
  if (input.dueTime !== undefined) { if (input.dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dueTime)) fail('Invalid due time'); patch.dueTime = input.dueTime || '' }
  if (input.order !== undefined) { if (!Number.isFinite(input.order) || Math.abs(input.order) > Number.MAX_SAFE_INTEGER) fail('Invalid order'); patch.order = input.order }
  if (input.tags !== undefined) { if (!Array.isArray(input.tags) || input.tags.length > 30) fail('Invalid tags'); patch.tags = input.tags.map(value => string(value, 'tag', 100)) }
  if (input.isRecurring !== undefined) { if (typeof input.isRecurring !== 'boolean') fail('Invalid recurrence'); patch.isRecurring = input.isRecurring }
  if (input.recurrence !== undefined && input.recurrence !== null) {
    const r = input.recurrence
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(r.pattern) || !Number.isInteger(r.interval ?? 1) || (r.interval ?? 1) < 1 || (r.interval ?? 1) > 365) fail('Invalid recurrence')
    patch.recurrence = { pattern: r.pattern, interval: r.interval ?? 1, endDate: date(r.endDate) }
    if (r.daysOfWeek !== undefined) { if (!Array.isArray(r.daysOfWeek) || r.daysOfWeek.some(d => !Number.isInteger(d) || d < 0 || d > 6)) fail('Invalid recurrence days'); patch.recurrence.daysOfWeek = [...new Set(r.daysOfWeek)] }
    if (r.dayOfMonth !== undefined) { if (!Number.isInteger(r.dayOfMonth) || r.dayOfMonth < 1 || r.dayOfMonth > 31) fail('Invalid recurrence date'); patch.recurrence.dayOfMonth = r.dayOfMonth }
  }
  if (input.reminders !== undefined) {
    if (!Array.isArray(input.reminders) || input.reminders.length > 10) fail('Invalid reminders')
    patch.reminders = input.reminders.map(r => {
      if (!['15min', '30min', '1hour', '1day', 'custom'].includes(r?.type)) fail('Invalid reminder type')
      if (r.type === 'custom' && (!Number.isSafeInteger(r.customMinutes) || r.customMinutes < 1 || r.customMinutes > 525600)) fail('Invalid reminder minutes')
      return { _id: id(), type: r.type, ...(r.type === 'custom' ? { customMinutes: r.customMinutes } : {}), sent: false, emailSent: false, pushSent: false, mobileSent: false }
    })
  }
  if (input.subtasks !== undefined) {
    if (!Array.isArray(input.subtasks) || input.subtasks.length > 200) fail('Invalid subtasks')
    patch.subtasks = input.subtasks.map(s => { if (s._id) assertId(s._id); return { _id: s._id || id(), title: string(s.title, 'subtask title', 500, false), completed: s.completed === true, completedAt: s.completed ? new Date() : null } })
  }
  return patch
}
function completion(next, previous, now) {
  if (next.status === previous?.status) return next
  if (next.status === 'pending') {
    next.completedAt = null
    for (const field of ['completedOnTime', 'daysOverdue', 'completionTime']) delete next.analytics[field]
  } else if (next.status === 'completed') {
    next.completedAt = now
    const due = next.dueDate ? new Date(next.dueDate) : null
    if (due) due.setHours(23, 59, 59, 999)
    next.analytics.completedOnTime = !due || now <= due
    next.analytics.daysOverdue = due && now > due ? Math.ceil((now - due) / 86400000) : 0
    next.analytics.completionTime = Math.round((now - new Date(next.createdAt)) / 36000) / 100
  }
  return next
}
export async function mutateTodo(database, user, todoId, operation, input = {}) {
  const patch = ['create', 'update'].includes(operation) ? todoPatch(input) : {}
  if (operation === 'create' && !patch.title) fail('Title is required')
  const newId = id()
  return database.transaction(async tx => {
    const account = await actor(tx, user), current = operation === 'create' ? null : await ownedTodoRecord(tx, 'personaltodos', account._id, todoId)
    if (!account.employeeId) fail('Employee not found', 404)
    const now = new Date(), next = { ...(current || { _id: newId, user: account._id, employee: idOf(account.employeeId), status: 'pending', priority: 'medium', subtasks: [], tags: [], reminders: [], order: Date.now(), isDeleted: false, isRecurring: false, createdAt: now }), ...patch, analytics: { timeSpent: 0, dueDateExtensions: 0, ...(current?.analytics || {}) }, updatedAt: now }
    if (patch.category) await ownedTodoRecord(tx, 'todocategories', account._id, patch.category)
    if (current?.dueDate && next.dueDate && new Date(next.dueDate) > new Date(current.dueDate)) next.analytics.dueDateExtensions++
    if (operation === 'delete') { next.isDeleted = true; next.deletedAt = now }
    if (operation === 'complete') next.status = current.status === 'completed' ? 'pending' : 'completed'
    if (operation.startsWith('subtask-')) {
      next.subtasks = [...(current.subtasks || [])]
      if (operation === 'subtask-create') {
        if (next.subtasks.length >= 200) fail('Subtask limit reached')
        next.subtasks.push({ _id: newId, title: string(input.title, 'subtask title', 500, false), completed: false })
      } else {
        assertId(input.subtaskId)
        const index = next.subtasks.findIndex(s => idOf(s) === input.subtaskId)
        if (index < 0) fail('Subtask not found', 404)
        if (operation === 'subtask-delete') next.subtasks.splice(index, 1)
        else {
          const sub = { ...next.subtasks[index] }
          if (input.title !== undefined) sub.title = string(input.title, 'subtask title', 500, false)
          if (input.completed !== undefined) { if (typeof input.completed !== 'boolean') fail('Invalid completion value'); sub.completed = input.completed; sub.completedAt = input.completed ? now : null }
          next.subtasks[index] = sub
        }
      }
    }
    completion(next, current, now)
    if (current) await tx.replace('personaltodos', next); else await tx.create('personaltodos', next)
    return next
  })
}
export async function mutateTodoCategory(database, user, categoryId, input = {}, remove = false) {
  const newId = id()
  return database.transaction(async tx => {
    const account = await actor(tx, user), current = categoryId ? await ownedTodoRecord(tx, 'todocategories', account._id, categoryId) : null
    const guard = await tx.get('todocategoryguards', account._id)
    const categories = (await tx.list('todocategories', { filters: [eq('user', account._id)], limit: 1000, requireComplete: true })).records.filter(r => !r.isDeleted)
    const now = new Date(), next = { ...(current || { _id: newId, user: account._id, color: '#6366f1', icon: 'folder', description: '', isDeleted: false, order: Math.max(0, ...categories.map(c => Number(c.order || 0))) + 1, createdAt: now }), updatedAt: now }
    for (const [key, max] of [['name', 100], ['color', 40], ['icon', 100], ['description', 2000]]) if (input[key] !== undefined) next[key] = string(input[key], key, max, key === 'description')
    if (!next.name) fail('Category name is required')
    if (input.order !== undefined) { if (!Number.isFinite(input.order)) fail('Invalid category order'); next.order = input.order }
    let todos = []
    if (remove) {
      if (current.isDefault) fail('Cannot delete the default category')
      todos = (await tx.list('personaltodos', { filters: [eq('user', account._id), eq('category', categoryId)], limit: 397, requireComplete: true })).records
      next.isDeleted = true; next.deletedAt = now
    } else if (categories.some(c => c._id !== next._id && c.name.toLowerCase() === next.name.toLowerCase())) fail('A category with this name already exists', 409)
    const nextGuard = { _id: account._id, revision: Number(guard?.revision || 0) + 1 }
    if (guard) await tx.replace('todocategoryguards', nextGuard); else await tx.create('todocategoryguards', nextGuard)
    if (current) await tx.replace('todocategories', next); else await tx.create('todocategories', next)
    for (const todo of todos) await tx.replace('personaltodos', { ...todo, category: null, updatedAt: now })
    return next
  }, { maxWrites: 400 })
}
