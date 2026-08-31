import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitRecruitmentUpdate, emitEmployeeUpdate } from '@/lib/realtimeEvents'
import { buildEmployeeLifecycle, createInitialLifecycleWorkflows } from '@/lib/hrms/employeeLifecycle.server'
import { sendAndLogOnboardingEmail } from '@/lib/mailer'
import { checkUserLimit, getTenantCompanyByDbName, registerUserTenantMapping } from '@/lib/tenantContext'

// POST - Convert hired candidate to employee
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'Employee', 'Department', 'Designation', 'User', 'Role', 'OnboardingEmail', 'CompanySettings', 'HrmsWorkflow', 'HrmsWorkflowEvent'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Candidate, Employee, User, Role, OnboardingEmail, CompanySettings } = models

    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Insufficient permissions' }, { status: 403 })
    }

    const data = await request.json()
    const { candidateId, employeeCode, joiningDate, designation, department } = data

    if (!candidateId) {
      return NextResponse.json({ success: false, message: 'Candidate ID is required' }, { status: 400 })
    }

    const candidate = await Candidate.findById(candidateId)
      .populate('jobPosting', 'jobTitle department designation')
    if (!candidate) {
      return NextResponse.json({ success: false, message: 'Candidate not found' }, { status: 404 })
    }

    if (candidate.stage !== 'hired' && candidate.offer?.status !== 'accepted') {
      return NextResponse.json(
        { success: false, message: 'Candidate must be in hired stage or have an accepted offer' },
        { status: 400 }
      )
    }

    if (candidate.convertedEmployeeId) {
      return NextResponse.json(
        { success: false, message: 'Candidate has already been converted to an employee' },
        { status: 409 }
      )
    }

    const effectiveEmployeeCode = employeeCode || `EMP-${Date.now().toString(36).toUpperCase()}`
    const [existingEmployee, existingUser, limitCheck] = await Promise.all([
      Employee.findOne({ $or: [{ email: candidate.email }, { employeeCode: effectiveEmployeeCode }] }).select('_id').lean(),
      User.findOne({ email: candidate.email }).select('_id').lean(),
      tenant?.databaseName ? checkUserLimit(tenant.databaseName) : Promise.resolve({ allowed: true }),
    ])
    if (existingEmployee || existingUser) {
      return NextResponse.json({ success: false, message: 'An employee or user with this email/code already exists' }, { status: 409 })
    }
    if (!limitCheck.allowed) {
      return NextResponse.json({ success: false, message: limitCheck.message || 'User limit reached' }, { status: 403 })
    }

    // Create employee record
    const employeeData = {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
      employeeCode: effectiveEmployeeCode,
      department: department || candidate.jobPosting?.department,
      designation: designation || candidate.jobPosting?.designation,
      dateOfJoining: joiningDate || candidate.offer?.joiningDate || new Date(),
      skills: candidate.skills,
      salary: (candidate.offer?.salary || candidate.expectedSalary)
        ? { grossSalary: Number(candidate.offer?.salary || candidate.expectedSalary) }
        : undefined,
    }

    try {
      employeeData.lifecycle = buildEmployeeLifecycle({ ...data, dateOfJoining: employeeData.dateOfJoining })
    } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    }
    employeeData.status = employeeData.lifecycle.stage !== 'preboarding' && employeeData.lifecycle.probation.applicable ? 'probation' : 'active'

    const employee = await Employee.create(employeeData)
    const temporaryPassword = `${crypto.randomBytes(12).toString('base64url')}aA1!`
    let employeeUser
    try {
      const employeeRole = await Role.findOne({ name: 'employee' }).select('_id').lean()
      employeeUser = await User.create({
        email: candidate.email,
        password: temporaryPassword,
        role: 'employee',
        roleId: employeeRole?._id,
        employeeId: employee._id,
        forcePasswordChange: true,
      })
      employee.userId = employeeUser._id
      await employee.save()
    } catch (error) {
      await Employee.deleteOne({ _id: employee._id }).catch(() => {})
      throw error
    }
    await createInitialLifecycleWorkflows({
      models,
      actor: user,
      employee,
      features: auth.companyFeatures,
    }).catch((error) => console.error('[Candidate Convert] Lifecycle workflow initialization failed:', error))

    const tenantCompany = tenant?.databaseName ? await getTenantCompanyByDbName(tenant.databaseName) : null
    if (tenantCompany) {
      await registerUserTenantMapping({
        email: candidate.email,
        tenantCompanyId: tenantCompany._id,
        databaseName: tenant.databaseName,
        companyName: tenantCompany.name,
        companySlug: tenantCompany.slug,
        role: 'employee',
      }).catch((error) => console.error('[Candidate Convert] Tenant mapping failed:', error))
    }

    await sendAndLogOnboardingEmail({
      employeeId: employee._id,
      userId: employeeUser._id,
      to: candidate.email,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      password: temporaryPassword,
      employeeCode: employee.employeeCode,
      designation: candidate.jobPosting?.jobTitle,
      dateOfJoining: employee.dateOfJoining,
      triggeredBy: 'candidate_conversion',
      models: { OnboardingEmail, CompanySettings },
    }).catch((error) => console.error('[Candidate Convert] Onboarding email failed:', error))

    // Update candidate with employee reference
    candidate.convertedEmployeeId = employee._id
    candidate.stage = 'hired'
    if (!candidate.stageHistory) candidate.stageHistory = []
    candidate.stageHistory.push({
      stage: 'hired',
      movedAt: new Date(),
      movedBy: user.employeeId?._id || user.employeeId,
      notes: `Converted to employee: ${employee.employeeCode}`,
    })
    await candidate.save()

    try {
      await logActivity({
        employeeId: user.employeeId?._id || user.employeeId,
        type: 'recruitment_hire',
        action: 'Converted candidate to employee',
        details: `Hired ${candidate.firstName} ${candidate.lastName} as ${employee.employeeCode}`,
        metadata: { candidateId, employeeId: employee._id },
        relatedModel: 'Employee',
        relatedId: employee._id,
      })
    } catch (e) {
      console.error('Activity log error (non-critical):', e)
    }

    emitRecruitmentUpdate({ candidate: candidateId, employee: employee._id }, { action: 'hire' })
    emitEmployeeUpdate({ action: 'created', employee, departmentId: employee.department })

    return NextResponse.json({
      success: true,
      message: 'Candidate converted to employee successfully',
      data: { candidate, employee },
    }, { status: 201 })
  } catch (error) {
    console.error('Convert candidate error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to convert candidate' },
      { status: 500 }
    )
  }
}
