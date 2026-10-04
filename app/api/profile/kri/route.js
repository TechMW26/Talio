import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProfileStore, getProfileRecords, populateProfileEmployee, invalidateProfile } from '@/lib/platform/firestoreProfile.server'
import { formatDesignation, formatDepartments } from '@/lib/formatters'
import { generateResponsibilitiesForEmployee } from '@/lib/kriGenerator'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user } = auth
    const store = await getProfileStore(auth.tenant.databaseName)
    const records = await getProfileRecords(store, user._id || user.userId)
    const employee = await populateProfileEmployee(store, records.employee)
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

    const responsibilities = await generateResponsibilitiesForEmployee(employee, user._id || user.userId, auth.tenant.databaseName)

    await store.mutate('employees', employee._id, current => {
      if (!current) throw new Error('Employee not found')
      return { ...current,
        aiGeneratedKRIs: responsibilities,
        aiGeneratedKRIsMeta: {
          generatedAt: new Date(),
          generatedFromDesignation: formatDesignation(employee.designation, employee),
          generatedFromDepartment: formatDepartments(employee),
        },
      }
    })
    await invalidateProfile(auth.tenant.databaseName, user._id || user.userId)

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
