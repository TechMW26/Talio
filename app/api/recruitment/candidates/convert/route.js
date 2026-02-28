import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { logActivity } from '@/lib/activityLogger'
import { emitRecruitmentUpdate, emitEmployeeUpdate } from '@/lib/realtimeEvents'

// POST - Convert hired candidate to employee
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Candidate', 'JobPosting', 'Employee', 'Department', 'Designation', 'User'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Candidate, JobPosting, Employee, User } = models

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

    // Create employee record
    const employeeData = {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
      employeeCode: employeeCode || `EMP-${Date.now().toString(36).toUpperCase()}`,
      department: department || candidate.jobPosting?.department,
      designation: designation || candidate.jobPosting?.designation,
      joiningDate: joiningDate || candidate.offer?.joiningDate || new Date(),
      status: 'active',
      skills: candidate.skills,
      salary: candidate.offer?.salary || candidate.expectedSalary,
    }

    const employee = await Employee.create(employeeData)

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
