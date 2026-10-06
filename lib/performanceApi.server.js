import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { financeError, assertFinanceId, freshFinanceActor } from '@/lib/finance.server'
import { performanceDatabase, performanceEmployees, scopedPerformanceRecords, populatePerformance, savePerformanceGoal, deletePerformanceGoal, savePerformanceReview, canManagePerformance, joinPerformanceEmployees, idOf, filter } from '@/lib/performanceStore.server'
export async function performanceApi(request, context, kind, action) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const database = await performanceDatabase(auth), actor = await freshFinanceActor(database, auth.user), params = new URL(request.url).searchParams
    const body = ['POST', 'PUT'].includes(action) ? await request.json() : {}
    const id = context ? (await context.params).id : kind === 'goals' ? body.goalId || params.get('goalId') : null
    const collection = kind === 'goals' ? 'performancegoals' : 'performances'
    if (action === 'GET') {
      if (id) {
        const record = await database.get(collection, assertFinanceId(id))
        if (!record) throw financeError('Record not found', 404)
        await performanceEmployees(database, actor, new URLSearchParams({ employeeId: idOf(record.employee) }), { activeOnly: false })
        return NextResponse.json({ success: true, data: (await populatePerformance(database, [record], kind === 'goals'))[0] })
      }
      const employees = await performanceEmployees(database, actor, params, { activeOnly: false }), filters = []
      if (kind === 'goals' && params.get('status')) filters.push(filter('status', params.get('status')))
      if (kind !== 'goals' && params.get('reviewPeriod')) filters.push(filter('reviewPeriod', params.get('reviewPeriod')))
      const rows = await scopedPerformanceRecords(database, collection, employees, filters, { orderBy: [{ field: 'createdAt', direction: 'desc' }] })
      rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      if (kind === 'goals') {
        const page = Math.max(1, Number(params.get('page')) || 1), limit = Math.max(1, Math.min(100, Number(params.get('limit')) || 50))
        return NextResponse.json({ success: true, data: await populatePerformance(database, rows.slice((page - 1) * limit, page * limit), true), pagination: { currentPage: page, totalPages: Math.ceil(rows.length / limit), totalItems: rows.length, itemsPerPage: limit } })
      }
      return NextResponse.json({ success: true, data: await populatePerformance(database, rows) })
    }
    if (action === 'DELETE') {
      if (kind === 'goals') await deletePerformanceGoal(database, actor, id)
      else await savePerformanceReview(database, actor, {}, id, true)
      return NextResponse.json({ success: true, message: 'Record deleted successfully' })
    }
    const record = kind === 'goals' ? await savePerformanceGoal(database, actor, body, id) : await savePerformanceReview(database, actor, body, id)
    return NextResponse.json({ success: true, message: id ? 'Record updated successfully' : 'Record created successfully', data: (await populatePerformance(database, [record], kind === 'goals'))[0] }, { status: id ? 200 : 201 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not process performance request' }, { status: error.status || 500 }) }
}
export async function ratingsApi(request, remove = false) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const database = await performanceDatabase(auth), actor = await freshFinanceActor(database, auth.user), params = new URL(request.url).searchParams
    if (remove) {
      const id = assertFinanceId(params.get('id'))
      await database.transaction(async tx => {
        const fresh = await freshFinanceActor(tx, actor)
        const found = await tx.list('employees', { filters: [filter('reviewIds', id, 'array-contains')], limit: 2 })
        if (found.records.length !== 1) throw financeError('Rating not found or requires reconciliation', found.records.length ? 409 : 404)
        const employee = found.records[0]
        if (!await canManagePerformance(tx, fresh, employee)) throw financeError('Rating access denied', 403)
        await tx.replace('employees', { ...employee, reviews: employee.reviews.filter(review => idOf(review) !== id), updatedAt: new Date() })
      })
      return NextResponse.json({ success: true, message: 'Rating deleted successfully' })
    }
    const employees = await joinPerformanceEmployees(database, await performanceEmployees(database, actor, params))
    const reviews = employees.flatMap(employee => (employee.reviews || []).map(review => ({ _id: review._id || `${employee._id}-${+new Date(review.createdAt)}`, employee: { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode, department: employee.department?.name || 'Unknown', designation: employee.designation, profilePicture: employee.profilePicture }, rater: review.reviewedBy || { firstName: 'Unknown', lastName: 'User' }, rating: review.rating || 0, content: review.content, category: review.category || 'general', type: review.type || 'review', createdAt: review.createdAt, ratingDate: review.createdAt })))
    reviews.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    return NextResponse.json({ success: true, data: reviews })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Could not process ratings' }, { status: error.status || 500 }) }
}
