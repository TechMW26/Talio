import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { EMPLOYEE_STORE_OPTIONS, listEmployees, populateEmployeeRoster } from '@/lib/employees.server'
import { prepareEmployeeCreate } from '@/lib/employeeInput.server'
import { provisionFirestoreAccount } from '@/lib/platform/firestoreProvisioning.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { ensureEmployeeLeaveBalances, LEAVE_BALANCE_STORE_OPTIONS } from '@/lib/leaveAllocation.server'
import { createInitialLifecycleWorkflows } from '@/lib/hrms/employeeLifecycle.server'
import { getWorkflowStore } from '@/lib/hrms/workflowStore.server'
import { sendAndLogOnboardingEmail } from '@/lib/mailer'
import { generateAndStoreKRIsKPIs } from '@/lib/kriGenerator'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

export const dynamic = 'force-dynamic'
const failure = error => NextResponse.json({ success: false, message: error.status ? error.message : error.code === 'ALREADY_EXISTS' ? 'Employee email or code is already in use' : 'Unable to load or save employees' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500) })

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, EMPLOYEE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message || 'Unauthorized' }, { status: auth.status || 401 })
    return NextResponse.json(await listEmployees(auth.database, new URL(request.url).searchParams))
  } catch (error) { return failure(error) }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, EMPLOYEE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message || 'Unauthorized' }, { status: auth.status || 401 })
    const input = await request.json()
    const employeeData = await prepareEmployeeCreate(auth.database, auth.user, input)
    const role = input.role || 'employee', password = input.password || 'employee123'
    const roleRecord = (await auth.database.list('roles', { filters: [{ field: 'name', operator: '==', value: role }], limit: 1 })).records[0]
    const { employee, user } = await provisionFirestoreAccount({ email: employeeData.email, password, role, employeeData }, {
      actor: { ...auth.user, databaseName: auth.tenant.databaseName },
      preparedEmployee: employeeData,
      preparedUser: { ...(employeeData.company ? { company: employeeData.company } : {}), ...(roleRecord ? { roleId: roleRecord._id } : {}) },
    })
    const warnings = []
    // Account, employee, tenant mapping and quota have already committed
    // together. Initialisation is idempotent and failures are visible to HR.
    try { await createInitialLifecycleWorkflows({ database: await getWorkflowStore(auth), actor: auth.user, employee, features: auth.companyFeatures }) }
    catch { warnings.push('Lifecycle initialization needs retry') }
    try { await ensureEmployeeLeaveBalances({ database: await getFirestoreTenantDatabase(auth.tenant.databaseName, LEAVE_BALANCE_STORE_OPTIONS), employeeId: employee._id, year: new Date(employee.dateOfJoining || Date.now()).getFullYear() }) }
    catch { warnings.push('Leave balance initialization needs retry') }
    const populated = (await populateEmployeeRoster(auth.database, [employee], { includeLifecycle: true }))[0]
    await Promise.all(['employees:list', 'directory:list'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace })).catch(() => {})))
    void sendAndLogOnboardingEmail({
      database: auth.database, employeeId: employee._id, userId: user._id, to: employee.email,
      firstName: employee.firstName, lastName: employee.lastName, email: employee.email, password,
      employeeCode: employee.employeeCode, designation: populated.designation?.title || employee.designationLevelName,
      department: populated.department?.name, dateOfJoining: employee.dateOfJoining, triggeredBy: 'manual_creation',
    }).catch(() => console.error('[Employee Create] Onboarding email initialization failed'))
    void generateAndStoreKRIsKPIs({ database: auth.database, employeeId: employee._id, userId: auth.user._id || auth.user.userId, generateKPIs: true })
      .catch(() => console.error('[Employee Create] KRI generation failed'))
    return NextResponse.json({
      success: true, message: 'Employee and user account created successfully', data: populated, warnings,
      credentials: { email: employee.email, password, message: 'Please share these credentials with the employee' },
    }, { status: 201 })
  } catch (error) { return failure(error) }
}

