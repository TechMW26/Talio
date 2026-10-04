import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getAuthAndDatabase } from '@/lib/auth'
import { provisionFirestoreAccount } from '@/lib/platform/firestoreProvisioning.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getRecruitmentDatabase, recruitmentId, recruitmentError } from '@/lib/recruitment/store.server'
import { buildEmployeeLifecycle, createInitialLifecycleWorkflows } from '@/lib/hrms/employeeLifecycle.server'
import { getWorkflowStore } from '@/lib/hrms/workflowStore.server'
import { ensureEmployeeLeaveBalances, LEAVE_BALANCE_STORE_OPTIONS } from '@/lib/leaveAllocation.server'
import { sendAndLogOnboardingEmail } from '@/lib/mailer'

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    if (!['admin', 'super_admin', 'hr'].includes(auth.user.role)) throw recruitmentError('Insufficient permissions', 403)
    const data = await request.json(), candidateId = recruitmentId(data.candidateId)
    const database = await getRecruitmentDatabase(auth)
    const candidate = await database.get('candidates', candidateId)
    if (!candidate) throw recruitmentError('Candidate not found', 404)
    if (candidate.convertedEmployeeId) throw recruitmentError('Candidate has already been converted to an employee', 409)
    const job = await database.get('jobpostings', String(candidate.jobPosting))
    if (!job) throw recruitmentError('Job posting not found', 404)
    const reportingManager = recruitmentId(data.reportingManager)
    const employeeData = {
      firstName: candidate.firstName, lastName: candidate.lastName, email: candidate.email, phone: candidate.phone || '',
      employeeCode: data.employeeCode || `EMP-${randomBytes(6).toString('hex').toUpperCase()}`,
      department: data.department || job.department, designation: data.designation || job.designation,
      reportingManager, assignedManager: reportingManager,
      dateOfJoining: new Date(data.joiningDate || candidate.offer?.joiningDate || Date.now()), skills: candidate.skills || [],
      salary: candidate.offer?.salary || candidate.expectedSalary ? { grossSalary: Number(candidate.offer?.salary || candidate.expectedSalary) } : undefined,
    }
    if (!Number.isFinite(employeeData.dateOfJoining.getTime())) throw recruitmentError('Invalid joining date')
    for (const [field, collection] of [['department', 'departments'], ['designation', 'designations']]) if (employeeData[field] && !await database.get(collection, recruitmentId(employeeData[field]))) throw recruitmentError(`Selected ${field} does not exist`, 400)
    employeeData.lifecycle = buildEmployeeLifecycle({ ...data, dateOfJoining: employeeData.dateOfJoining })
    employeeData.status = employeeData.lifecycle.stage !== 'preboarding' && employeeData.lifecycle.probation.applicable ? 'probation' : 'active'
    const password = `${randomBytes(12).toString('base64url')}aA1!`
    const result = await provisionFirestoreAccount({ email: candidate.email, password, role: 'employee', employeeData }, {
      actor: { ...auth.user, databaseName: auth.tenant.databaseName }, preparedEmployee: employeeData, candidateId,
    })
    const employee = result.employee, warnings = []
    // These post-commit steps never roll back an already-created account.
    // Return explicit warnings so HR can retry the respective workflow safely.
    await createInitialLifecycleWorkflows({ database: await getWorkflowStore(auth), actor: auth.user, employee, features: auth.companyFeatures }).catch(() => warnings.push('Lifecycle checklist initialization needs retry'))
    await ensureEmployeeLeaveBalances({ database: await getFirestoreTenantDatabase(auth.tenant.databaseName, LEAVE_BALANCE_STORE_OPTIONS), employeeId: employee._id, year: employee.dateOfJoining.getFullYear() }).catch(() => warnings.push('Leave balance allocation needs retry'))
    await sendAndLogOnboardingEmail({
      database, employeeId: employee._id, userId: result.user._id, to: employee.email,
      firstName: employee.firstName, lastName: employee.lastName, email: employee.email,
      password, employeeCode: employee.employeeCode, designation: job.jobTitle, dateOfJoining: employee.dateOfJoining,
      triggeredBy: 'candidate_conversion',
    }).catch(() => warnings.push('Onboarding email could not be confirmed; review the onboarding email log before retrying'))
    return NextResponse.json({ success: true, message: 'Candidate converted to employee successfully', data: { candidate: result.candidate, employee }, ...(warnings.length ? { warnings } : {}) }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message || 'Failed to convert candidate' }, { status: error.status || 500 })
  }
}
