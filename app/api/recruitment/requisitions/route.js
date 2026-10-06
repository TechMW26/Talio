import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { emitRecruitmentUpdate } from '@/lib/realtimeEvents'
import { HR_ROLES, canRequestManpower, isManpowerHr, manpowerError, validateManpower, reviewManpower, submitManpower } from '@/lib/recruitment/manpower.server'
import { getManpowerStore, hasDepartmentLeadership, manpowerDepartments } from '@/lib/recruitment/manpowerStore.server'

export const dynamic = 'force-dynamic'
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function context(request) {
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) throw manpowerError(auth.message || 'Sign in required', auth.status || 401)
  const store = await getManpowerStore(auth)
  const actor = await store.get('users', String(auth.user._id || auth.user.userId))
  if (!actor || actor.isActive === false) throw manpowerError('Active account required', 403)
  if (!canRequestManpower(actor) && actor.employeeId && await hasDepartmentLeadership(store, actor.employeeId)) actor.isDepartmentHead = true
  if (!canRequestManpower(actor)) throw manpowerError('Leadership or HR access is required', 403)
  return { actor, store }
}
const failed = error => json({ success: false, message: error.status ? error.message : 'Could not save this request. Refresh and retry.' }, error.status || 500)
export async function GET(request) {
  try {
    const { actor, store } = await context(request)
    const url = new URL(request.url)
    const page = Math.floor(Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1)))
    const scope = isManpowerHr(actor) ? [] : [{ field: 'requestedBy', operator: '==', value: String(actor._id) }]
    const status = url.searchParams.get('status') || 'all'
    if (!['all', 'pending', 'approved', 'rejected'].includes(status)) throw manpowerError('Invalid request status')
    const filters = status === 'all' ? scope : [...scope, { field: 'status', operator: '==', value: status }]
    const options = { filters, orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 20 }
    let cursor = url.searchParams.get('cursor') || undefined
    let beyondLastPage = false
    // Preserve numbered-page clients and offer cursors for constant-cost navigation.
    if (!cursor) for (let number = 1; number < page; number++) {
      const previous = await store.list('manpowerrequests', { ...options, cursor })
      cursor = previous.nextCursor
      if (!cursor) { beyondLastPage = true; break }
    }
    const [result, total, departments, pending, approved, rejected] = await Promise.all([
      beyondLastPage ? { records: [], nextCursor: null } : store.list('manpowerrequests', { ...options, cursor }),
      store.count('manpowerrequests', filters), manpowerDepartments(store),
      ...['pending', 'approved', 'rejected'].map(value => store.count('manpowerrequests', [...scope, { field: 'status', operator: '==', value }])),
    ])
    const data = await Promise.all(result.records.map(async record => {
      const [employee, department] = await Promise.all([store.get('employees', String(record.employee)), store.get('departments', String(record.department))])
      return { ...record,
        employee: employee ? { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode } : null,
        department: department ? { _id: department._id, name: department.name } : null,
        canReview: isManpowerHr(actor) && String(record.requestedBy) !== String(actor._id) && record.status === 'pending',
      }
    }))
    return json({ success: true, data, departments, total, page, nextCursor: result.nextCursor, stats: { all: pending + approved + rejected, pending, approved, rejected }, isHr: isManpowerHr(actor), canSubmit: Boolean(actor.employeeId) })
  } catch (error) { return failed(error) }
}
export async function POST(request) {
  try {
    const { actor, store } = await context(request)
    let input
    try { input = await request.json() } catch { throw manpowerError('Invalid request body') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw manpowerError('Invalid request body')
    if (input.action !== 'submit') {
      const { record, repeated } = await reviewManpower(store, actor, input)
      if (record.jobPosting && !repeated) {
        try {
          const job = await store.get('jobpostings', String(record.jobPosting))
          if (job) { const department = await store.get('departments', String(job.department)); emitRecruitmentUpdate({ ...job, department: department ? { _id: department._id, name: department.name } : null }, { action: 'create' }) }
        } catch { /* Saved job remains available to refresh and connector sync. */ }
      }
      return json({ success: true, data: record, message: record.status === 'approved' ? 'Approved and published in Talio. Configured recruitment connectors will pick up the job on their next sync.' : 'Request rejected and requester notified.' })
    }
    if (!actor.employeeId) throw manpowerError('An employee profile is required to submit', 403)
    if (typeof input.submissionKey !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(input.submissionKey)) throw manpowerError('Invalid submission key. Reload the form.')
    const { job, justification } = validateManpower(input)
    const reviewers = []
    let cursor
    do {
      const result = await store.list('users', { filters: [{ field: 'role', operator: 'in', value: HR_ROLES }], limit: 100, cursor })
      reviewers.push(...result.records.filter(user => String(user._id) !== String(actor._id) && user.isActive !== false))
      cursor = result.nextCursor
    } while (cursor)
    const record = await submitManpower(store, actor, { job, justification, submissionKey: input.submissionKey }, reviewers)
    return json({ success: true, data: { id: record._id }, message: 'Request submitted to HR.' })
  } catch (error) { return failed(error) }
}
