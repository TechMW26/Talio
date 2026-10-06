import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { acceptAndStartExit } from '@/lib/hrms/resignationExit.server'
import { getResignationStore } from '@/lib/hrms/resignationStore.server'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { getAuthAndDatabase } from '@/lib/auth'
import { HR_ROLES, idOf, isHr, failure, reasonText, publicResignation, transition, resolveReviewers, notifyResignation } from '@/lib/hrms/resignation.server'

export const dynamic = 'force-dynamic'
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function context(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) throw failure(auth.message || 'Please sign in', auth.status || 401)
  const store = await getResignationStore(auth)
  const actor = await store.get('users', idOf(auth.user._id || auth.user.userId))
  if (!actor || actor.isActive === false) throw failure('Active account required', 403)
  return { ...auth, actor, store }
}
const visible = (record, actor) => idOf(record.requestedBy) === idOf(actor._id) || isHr(actor) || record.reviewers.some(id => idOf(id) === idOf(actor._id))
const failed = error => json({ success: false, message: error.code === 'ACTIVE_RESIGNATION' ? 'An active resignation already exists. Refresh your profile.' : error.status ? error.message : 'Could not process resignation. Please retry.' }, error.code === 'ACTIVE_RESIGNATION' ? 409 : error.status || 500)
export async function GET(request) {
  try {
    const { actor, store } = await context(request)
    const scopes = isHr(actor) ? [[]] : [[{ field: 'requestedBy', operator: '==', value: idOf(actor) }], [{ field: 'reviewers', operator: 'array-contains', value: idOf(actor) }]]
    const matches = await Promise.all(scopes.map(async filters => {
      const options = { filters, orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 100 }
      const first = await store.list('resignationrequests', options)
      const second = first.nextCursor ? await store.list('resignationrequests', { ...options, cursor: first.nextCursor }) : { records: [] }
      return [...first.records, ...second.records]
    }))
    const unique = [...new Map(matches.flat().map(record => [idOf(record), record])).values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 200)
    const records = await Promise.all(unique.map(async record => {
      const employee = await store.get('employees', idOf(record.employee))
      const timeline = await Promise.all((record.timeline || []).map(async event => {
        const user = event.actor ? await store.get('users', idOf(event.actor)) : null
        return { ...event, actor: user ? { _id: user._id, email: user.email } : null }
      }))
      return { ...record, employee: employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode } : null, timeline }
    }))
    return json({ success: true, data: records.map(r => publicResignation(r, actor)), canManageExits: isHr(actor), canSubmit: Boolean(actor.employeeId) })
  } catch (error) { return failed(error) }
}
export async function POST(request) {
  try {
    const { actor, store, companyFeatures } = await context(request)
    if (!isFeatureEnabled(companyFeatures, 'exitManagement')) throw failure('Exit management is disabled for this organisation', 403)
    let input
    try { input = await request.json() } catch { throw failure('Invalid request body') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Invalid request body')
    const hrUsers = []
    let cursor
    do {
      const page = await store.list('users', { filters: [{ field: 'role', operator: 'in', value: HR_ROLES }], limit: 100, cursor })
      hrUsers.push(...page.records.filter(user => user.isActive !== false).map(user => user._id))
      cursor = page.nextCursor
    } while (cursor)
    let record
    if (input.action === 'submit') {
      if (!actor.employeeId) throw failure('An employee profile is required to resign', 403)
      if (!hrUsers.some(id => idOf(id) !== idOf(actor._id))) throw failure('An independent HR/admin reviewer must be configured before submitting', 409)
      const reason = reasonText(input.reason)
      const requestId = randomBytes(12).toString('hex')
      record = await store.transaction(async tx => {
        const [employee, lock, active] = await Promise.all([
          tx.get('employees', idOf(actor.employeeId)),
          tx.get('resignationlocks', idOf(actor.employeeId)),
          tx.list('resignationrequests', { filters: [{ field: 'employee', operator: '==', value: idOf(actor.employeeId) }, { field: 'active', operator: '==', value: true }], limit: 1 }),
        ])
        if (!employee || ['resigned', 'terminated', 'inactive'].includes(employee.status)) throw failure('An active employee profile is required', 403)
        if (active.records.length) throw Object.assign(new Error('Active resignation exists'), { code: 'ACTIVE_RESIGNATION' })
        const now = new Date()
        const created = { _id: requestId, employee: employee._id, requestedBy: actor._id, reason, status: 'hr_review', active: true, version: 0, reviewers: [], timeline: [{ action: 'submit', actor: actor._id, at: now, reason }], createdAt: now, updatedAt: now }
        await tx.create('resignationrequests', created)
        const claim = { _id: idOf(employee), resignation: requestId, updatedAt: now }
        if (lock) await tx.replace('resignationlocks', claim)
        else await tx.create('resignationlocks', claim)
        return created
      })
    } else {
      if (!/^[a-f\d]{24}$/i.test(input.id || '')) throw failure('Invalid resignation request')
      const current = await store.get('resignationrequests', input.id)
      if (!current || !visible(current, actor)) throw failure('Request not found', 404)
      if (!Number.isInteger(input.version) || current.version !== input.version) throw failure('This request changed. Refresh before acting.', 409)
      const { update, event } = transition(current, actor, input)
      if (['approve', 'return', 'forward_negotiation'].includes(input.action)) {
        const employee = await store.get('employees', idOf(current.employee))
        if (!employee) throw failure('Employee profile is unavailable', 409)
        update.reviewers = await resolveReviewers(store, employee, current.requestedBy)
        if (!update.reviewers.length) throw failure('Assign an active manager, TL or department head to this employee before forwarding.', 409)
      }
      record = input.action === 'accept' ? await acceptAndStartExit(store, current, input, update, event) : await store.transaction(async tx => {
        const latest = await tx.get('resignationrequests', input.id)
        if (!latest || latest.version !== input.version || latest.status !== current.status) throw failure('Another reviewer updated this request. Refresh before acting.', 409)
        const changed = { ...latest, ...update, version: latest.version + 1, timeline: [...(latest.timeline || []), event], updatedAt: new Date() }
        await tx.replace('resignationrequests', changed)
        return changed
      })
      if (!record) throw failure('Another reviewer updated this request. Refresh before acting.', 409)
    }
    const notificationDelayed = await notifyResignation(store, record, hrUsers.filter(id => idOf(id) !== idOf(record.requestedBy)))
    return json({ success: true, message: notificationDelayed ? 'Saved. Some notifications could not be delivered; the request is available in the profile review inbox.' : 'Resignation request updated.', data: { id: idOf(record._id) } })
  } catch (error) { return failed(error) }
}
