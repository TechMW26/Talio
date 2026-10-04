import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { LEAVE_BALANCE_STORE_OPTIONS } from '@/lib/leaveAllocation.server'
import { listLeaveBalances, adjustLeaveBalance } from '@/lib/leaveBalances.server'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

const failure = error => NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to load or update leave balances' }, { status: error.status || 500 })

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_BALANCE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const params = new URL(request.url).searchParams
    const year = params.has('year') ? Number(params.get('year')) : new Date().getFullYear()
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

