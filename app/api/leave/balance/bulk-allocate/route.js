import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { buildLeaveBalanceFields, normalizeLeaveType } from '@/lib/leaveData'
// POST - Bulk allocate leave for all employees
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'LeaveType', 'LeaveBalance'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Employee, LeaveType, LeaveBalance } = models
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const { year } = await request.json()
    
    if (!year) {
      return NextResponse.json(
        { success: false, message: 'Year is required' },
        { status: 400 }
      )
    }

    // Get all active employees
    const employees = await Employee.find({ status: 'active' })
    
    // Get all active leave types
    const leaveTypes = await LeaveType.find({ isActive: true })

    if (employees.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No active employees found' },
        { status: 400 }
      )
    }

    if (leaveTypes.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No active leave types found' },
        { status: 400 }
      )
    }

    let allocatedCount = 0
    let skippedCount = 0

    // Allocate leave for each employee and leave type combination
    for (const employee of employees) {
      for (const leaveType of leaveTypes) {
        const normalizedLeaveType = normalizeLeaveType(leaveType)
        // Check if allocation already exists
        const existingBalance = await LeaveBalance.findOne({
          employee: employee._id,
          leaveType: leaveType._id,
          year: year,
        })

        if (existingBalance) {
          skippedCount++
          continue
        }

        // Create new leave balance allocation
        await LeaveBalance.create({
          employee: employee._id,
          leaveType: leaveType._id,
          year: year,
          ...buildLeaveBalanceFields({
            totalDays: normalizedLeaveType.maxDaysPerYear,
          }),
        })

        allocatedCount++
      }
    }

    await clearCachePattern(buildCachePattern({
      tenantId: tenant?.databaseName,
      namespace: 'leave-balance',
      userId: '*',
    }))
    await clearCachePattern(buildCachePattern({
      tenantId: tenant?.databaseName,
      namespace: 'dashboard:unified',
      userId: '*',
    }))

    return NextResponse.json({
      success: true,
      message: `Bulk allocation completed successfully`,
      allocated: allocatedCount,
      skipped: skippedCount,
      totalEmployees: employees.length,
      totalLeaveTypes: leaveTypes.length,
    })
  } catch (error) {
    console.error('Bulk allocate error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to perform bulk allocation' },
      { status: 500 }
    )
  }
}
