import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getLifecycleDatabase } from '@/lib/hrms/lifecycleStore.server'
import { performanceDatabase } from '@/lib/performanceStore.server'
import { listAppraisals } from '@/lib/hrms/performanceAppraisalStore.server'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { canReadWorkflow } from '@/lib/hrms/workflowStore.server'
import { isDirectReport } from '@/lib/teamScope'
import { employeeHistory } from '@/lib/hrms/employeeHistory'
import { getLifecycleProgress } from '@/lib/hrms/employeeLifecycle.server'

export const dynamic = 'force-dynamic'
export async function GET(request, { params }) {
  try {
    const { id } = await params
    if (!/^[a-f\d]{24}$/i.test(id || '')) return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    const database = await getLifecycleDatabase(auth)
    const employee = await database.get('employees', id)
    if (!employee) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const own = String(auth.user.employeeId?._id || auth.user.employeeId || '')
    const hr = ['admin', 'hr', 'superadmin', 'super_admin'].includes(auth.user.role)
    if (!hr && own !== id && !(['manager', 'department_head'].includes(auth.user.role) && isDirectReport(employee, own))) return NextResponse.json({ success: false, message: 'Lifecycle history is restricted to authorized HR, managers and the employee.' }, { status: 403 })
    const filter = field => [{ field, operator: '==', value: id }]
    const [approvals, workflows, appraisals] = await Promise.all([
      collectFirestorePages(database, 'probationapprovals', { filters: filter('employee') }),
      collectFirestorePages(database, 'hrmsworkflows', { filters: filter('subjectEmployee') }),
      Promise.resolve(performanceDatabase(auth)).then(db => listAppraisals(db, auth.user, new URLSearchParams({ employeeId: id }))),
    ])
    return NextResponse.json({ success: true, data: {
      stage: employee.lifecycle?.stage || employee.status || 'Not recorded',
      progress: employee.lifecycle?.onboarding?.checklist?.length ? getLifecycleProgress(employee.lifecycle) : null,
      events: employeeHistory(employee, approvals, appraisals.data, workflows.filter(row => canReadWorkflow(auth.user, row))),
      note: 'Only recorded history is shown. Past promotions cannot be inferred from the current designation. Appraisal history includes up to 500 records.',
    } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to load lifecycle history' }, { status: error.status || 500 })
  }
}
