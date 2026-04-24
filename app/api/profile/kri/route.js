import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { formatDesignation, formatDepartments } from '@/lib/formatters'
import { generateResponsibilitiesForEmployee } from '@/lib/kriGenerator'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { Employee, User } = models

    const userRecord = await User.findById(user._id || user.userId)
      .populate([
        { path: 'employeeId', populate: { path: 'designation', select: 'title level levelName' } },
        { path: 'employeeId.department', select: 'name' },
        { path: 'employeeId.departments', select: 'name' },
      ])

    const employee = userRecord?.employeeId
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee profile not found' }, { status: 404 })
    }

    const refresh = new URL(request.url).searchParams.get('refresh') === 'true'
    const hasCached = Array.isArray(employee.aiGeneratedKRIs) && employee.aiGeneratedKRIs.length > 0

    if (hasCached && !refresh) {
      return NextResponse.json({
        success: true,
        data: {
          responsibilities: employee.aiGeneratedKRIs,
          meta: employee.aiGeneratedKRIsMeta || null,
          designation: formatDesignation(employee.designation, employee),
          department: formatDepartments(employee),
        },
      })
    }

    const responsibilities = await generateResponsibilitiesForEmployee(employee, user._id || user.userId)

    await Employee.findByIdAndUpdate(employee._id, {
      $set: {
        aiGeneratedKRIs: responsibilities,
        aiGeneratedKRIsMeta: {
          generatedAt: new Date(),
          generatedFromDesignation: formatDesignation(employee.designation, employee),
          generatedFromDepartment: formatDepartments(employee),
        },
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        responsibilities,
        meta: {
          generatedAt: new Date(),
          generatedFromDesignation: formatDesignation(employee.designation, employee),
          generatedFromDepartment: formatDepartments(employee),
        },
        designation: formatDesignation(employee.designation, employee),
        department: formatDepartments(employee),
      },
    })
  } catch (error) {
    console.error('Profile KRI generation error:', error)
    return NextResponse.json({ success: false, message: error.message || 'Failed to generate KRIs' }, { status: 500 })
  }
}

export async function POST(request) {
  return GET(request)
}
