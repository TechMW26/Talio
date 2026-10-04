import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { EMPLOYED_STATUSES, LEAVE_BALANCE_STORE_OPTIONS, ensureEmployeeLeaveBalances } from '@/lib/leaveAllocation.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { validateLeaveYear } from '@/lib/leaveBalances.server'
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_BALANCE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    const year = Number((await request.json()).year)
    validateLeaveYear(year)
    const [employees, types] = await Promise.all([
      collectFirestorePages(auth.database, 'employees', { filters: [{ field: 'status', operator: 'in', value: [...EMPLOYED_STATUSES] }] }),
      collectFirestorePages(auth.database, 'leavetypes', { filters: [{ field: 'isActive', operator: '==', value: true }] }),
    ])
    if (!employees.length || !types.length) return NextResponse.json({ success: false, message: 'Active employees and leave types are required' }, { status: 400 })
    let allocated = 0, skipped = 0
    for (const employee of employees) {
      const result = await ensureEmployeeLeaveBalances({ database: auth.database, employeeId: employee._id, year })
      allocated += result.allocated; skipped += result.skipped
    }
    await Promise.all(['leave-balance', 'dashboard:unified'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace, userId: '*' })).catch(() => {})))
    return NextResponse.json({ success: true, message: 'Bulk allocation completed successfully', allocated, skipped, totalEmployees: employees.length, totalLeaveTypes: types.length })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Allocation did not complete; retrying safely preserves existing balances' }, { status: error.status || 500 }) }
}
