import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { LEAVE_BALANCE_STORE_OPTIONS } from '@/lib/leaveAllocation.server'
import { buildNoticePreview, listLeaveBalances, listLeaveBalanceSummary, adjustLeaveBalance } from '@/lib/leaveBalances.server'
import { currentFiscalYear } from '@/lib/leavePolicy'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

const failure = error => NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to load or update leave balances' }, { status: error.status || 500 })
const invalidAsOf = value => {
  if (!value) return false
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
}

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_BALANCE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const params = new URL(request.url).searchParams
    const year = params.has('year') ? Number(params.get('year')) : currentFiscalYear()
    if (invalidAsOf(params.get('asOf'))) return NextResponse.json({ success: false, message: 'Invalid as-of date' }, { status: 400 })
    const startDate = params.get('startDate'), endDate = params.get('endDate')
    if (Boolean(startDate) !== Boolean(endDate)) return NextResponse.json({ success: false, message: 'Provide both startDate and endDate' }, { status: 400 })
    if (params.get('summary') === '1') {
      const data = await listLeaveBalanceSummary(auth.database, auth.user, { employeeId: params.get('employeeId'), year, asOf: params.get('asOf') || undefined })
      const preview = startDate && endDate
        ? await buildNoticePreview(auth.database, auth.user, { employeeId: params.get('employeeId'), startDate, endDate })
        : null
      return NextResponse.json({ success: true, data, ...(preview ? { preview } : {}) })
    }
    const data = await listLeaveBalances(auth.database, auth.user, { employeeId: params.get('employeeId'), year })
    return NextResponse.json({ success: true, data })
  } catch (error) { return failure(error) }
}
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_BALANCE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const result = await adjustLeaveBalance(auth.database, auth.user, await request.json())
    await clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace: 'leave-balance', userId: '*' })).catch(() => {})
    return NextResponse.json({ success: true, message: `Leave balance ${result.created ? 'created' : 'updated'} successfully`, data: result.data }, { status: result.created ? 201 : 200 })
  } catch (error) { return failure(error) }
}

