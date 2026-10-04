import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { readAdminPage } from './platform/firestoreSuperadmin.server'
import { processProjectEmailNotificationLog } from './projectEmailNotifications'
import { projectRows, projectFilter as f, projectId as id, employeeSummary, projectFailure as fail } from './projects.server'
const COLLECTION = 'projectemailnotificationlogs'
const options = { queryFields: { [COLLECTION]: ['status', 'triggerType', 'project', 'task', 'createdAt', 'recipientEmail', 'recipientName', 'subject', 'sentAt', 'searchGrams'] } }
async function authDatabase(request) {
  const auth = await getAuthAndDatabase(request, options)
  if (!auth.success) fail(auth.message, 401)
  if (!['admin', 'hr'].includes(auth.user.role)) fail('Access denied', 403)
  return auth.database
}
async function view(database, record) {
  if (!record) return null
  const { deliveryToken, searchGrams, ...safe } = record
  const result = { ...safe }
  for (const key of ['recipientEmployee', 'triggeredByEmployee']) if (record[key]) result[key] = employeeSummary(await database.get('employees', id(record[key])))
  for (const key of ['recipientUser', 'triggeredByUser']) if (record[key]) { const user = await database.get('users', id(record[key])); result[key] = user ? { _id: user._id, email: user.email } : null }
  if (record.project) { const project = await database.get('projects', id(record.project)); result.project = project ? { _id: project._id, name: project.name, projectName: project.name, projectCode: project.projectCode, status: project.status } : null }
  if (record.task) { const task = await database.get('tasks', id(record.task)); result.task = task ? { _id: task._id, title: task.title, taskName: task.title, status: task.status } : null }
  return result
}
const safe = fn => async (request, route) => { try { return await fn(request, route ? await route.params : {}) } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: error.status || 500 }) } }
export const listProjectEmails = safe(async request => {
  const database = await authDatabase(request), query = new URL(request.url).searchParams, filters = []
  const page = Math.max(1, parseInt(query.get('page')) || 1), limit = Math.min(100, Math.max(1, parseInt(query.get('limit')) || 20)), search = (query.get('search') || '').trim().toLowerCase().slice(0, 100)
  for (const [key, field] of [['status', 'status'], ['triggerType', 'triggerType'], ['projectId', 'project'], ['taskId', 'task']]) if (query.get(key)) filters.push(f(field, query.get(key)))
  const sortBy = ['createdAt', 'recipientEmail', 'recipientName', 'sentAt', 'status'].includes(query.get('sortBy')) ? query.get('sortBy') : 'createdAt', direction = query.get('sortOrder') === 'asc' ? 'asc' : 'desc'
  let rows, total, nextCursor
  if (search) {
    filters.push(f('searchGrams', search.slice(0, 3), 'array-contains'))
    rows = (await projectRows(database, COLLECTION, filters)).filter(row => [row.recipientEmail, row.recipientName, row.subject].some(value => String(value || '').toLowerCase().includes(search))).sort((a, b) => (a[sortBy] > b[sortBy] ? 1 : a[sortBy] < b[sortBy] ? -1 : 0) * (direction === 'asc' ? 1 : -1))
    total = rows.length; rows = rows.slice((page - 1) * limit, page * limit)
  } else {
    const [result, count] = await Promise.all([readAdminPage(database, COLLECTION, { filters, orderBy: [{ field: sortBy, direction }], skip: (page - 1) * limit, limit, cursor: query.get('cursor') }), database.count(COLLECTION, filters)])
    rows = result.records; total = count; nextCursor = result.nextCursor
  }
  const [sent, failed, pending] = await Promise.all(['sent', 'failed', 'pending'].map(value => database.count(COLLECTION, [f('status', value)])))
  return NextResponse.json({ success: true, data: await Promise.all(rows.map(row => view(database, row))), pagination: { page, limit, total, pages: Math.ceil(total / limit), nextCursor }, stats: { sent, failed, pending, total: sent + failed + pending } })
})
export const getProjectEmail = safe(async (request, { id: recordId }) => {
  const database = await authDatabase(request), record = await database.get(COLLECTION, recordId)
  if (!record) fail('Email log not found', 404)
  return NextResponse.json({ success: true, data: await view(database, record) })
})
export const retryProjectEmail = safe(async (request, { id: recordId }) => {
  const database = await authDatabase(request)
  const record = await database.mutate(COLLECTION, recordId, current => {
    if (!current) fail('Email log not found', 404)
    if (current.status === 'sent') return current
    if (new Date(current.deliveryLeaseUntil || 0) > new Date()) fail('Email is already being processed', 409)
    return { ...current, autoRetryCount: 0, rateLimitedUntil: null, scheduledFor: null, queued: false, updatedAt: new Date() }
  })
  if (record.status === 'sent') return NextResponse.json({ success: true, alreadySent: true, message: 'Email already sent' })
  const result = await processProjectEmailNotificationLog(record, database)
  return NextResponse.json({ success: Boolean(result?.success), message: result?.success ? 'Email sent successfully' : `Failed to send email: ${result?.error || 'unknown error'}`, data: await view(database, await database.get(COLLECTION, recordId)) })
})
