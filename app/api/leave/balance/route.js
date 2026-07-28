import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, buildCachePattern, clearCachePattern, getCache, setCache } from '@/lib/cache'
import {
  buildLeaveBalanceFields,
  normalizeLeaveBalance,
  normalizeLeaveBalances,
} from '@/lib/leaveData'

// GET - Get leave balances
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['LeaveBalance', 'Employee', 'LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { LeaveBalance, Employee, LeaveType } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const year = parseInt(searchParams.get('year')) || new Date().getFullYear()

    // If employeeId is provided, get balance for specific employee
    if (employeeId) {
      const cacheKey = buildCacheKey({
        tenantId: tenant?.databaseName,
        role: user.role,
        userId: user._id || user.userId,
        namespace: 'leave-balance',
        params: { employeeId, year, formatVersion: 2 }
      })

      const cached = await getCache(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }

      const leaveBalances = await LeaveBalance.find({
        employee: employeeId,
        year: year
      }).populate('leaveType', 'name color code').lean()

      const response = {
        success: true,
        data: normalizeLeaveBalances(leaveBalances),
      }

      await setCache(cacheKey, response, 5 * 60)

      return NextResponse.json(response)
    }

    // If no employeeId and user is admin/hr, get all balances
    if (['admin', 'hr'].includes(user.role)) {
      const cacheKey = buildCacheKey({
        tenantId: tenant?.databaseName,
        role: user.role,
        userId: 'all',
        namespace: 'leave-balance',
        params: { year, scope: 'all', formatVersion: 2 }
      })

      const cached = await getCache(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }

      const leaveBalances = await LeaveBalance.find({ year: year })
        .populate('employee', 'employeeCode firstName lastName email department')
        .populate('leaveType', 'name color code')
        .sort({ 'employee.employeeCode': 1 })
        .lean()

      const response = {
        success: true,
        data: normalizeLeaveBalances(leaveBalances),
      }

      await setCache(cacheKey, response, 5 * 60)

      return NextResponse.json(response)
    }

    // For regular employees, get their own balance
    const employee = await Employee.findOne({ _id: user._id || user.userId })
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: user._id || user.userId,
      namespace: 'leave-balance',
      params: { employeeId: employee._id.toString(), year, formatVersion: 2 }
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const leaveBalances = await LeaveBalance.find({
      employee: employee._id,
      year: year
    }).populate('leaveType', 'name color code').lean()

    const response = {
      success: true,
      data: normalizeLeaveBalances(leaveBalances),
    }

    await setCache(cacheKey, response, 5 * 60)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get leave balance error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch leave balance' },
      { status: 500 }
    )
  }
}

// POST - Create/Update leave balance (Admin/HR only)
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['LeaveBalance', 'Employee', 'LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { LeaveBalance, Employee, LeaveType } = models

    // Only admin/hr can create/update leave balances
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { employee, leaveType, totalDays, year } = body

    // Validate required fields
    const parsedTotalDays = Number(totalDays)
    const parsedYear = Number(year)
    if (
      !employee ||
      !leaveType ||
      !Number.isFinite(parsedTotalDays) ||
      parsedTotalDays < 0 ||
      !Number.isInteger(parsedYear)
    ) {
      return NextResponse.json(
        { success: false, message: 'Employee, leave type, total days, and year are required' },
        { status: 400 }
      )
    }

    // Check if balance already exists
    const existingBalance = await LeaveBalance.findOne({
      employee,
      leaveType,
      year: parsedYear
    })

    if (existingBalance) {
      // Update existing balance
      const currentBalance = normalizeLeaveBalance(existingBalance)
      existingBalance.set(buildLeaveBalanceFields({
        totalDays: parsedTotalDays,
        usedDays: currentBalance.usedDays,
        pending: currentBalance.pending,
        carriedForward: currentBalance.carriedForward,
      }))
      await existingBalance.save()

      await existingBalance.populate('employee', 'employeeCode firstName lastName')
      await existingBalance.populate('leaveType', 'name color code')

      const response = {
        success: true,
        message: 'Leave balance updated successfully',
        data: normalizeLeaveBalance(existingBalance)
      }

      await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'leave-balance', userId: '*' }))

      return NextResponse.json(response)
    } else {
      // Create new balance
      const leaveBalance = new LeaveBalance({
        employee,
        leaveType,
        year: parsedYear,
        ...buildLeaveBalanceFields({ totalDays: parsedTotalDays }),
      })

      await leaveBalance.save()

      await leaveBalance.populate('employee', 'employeeCode firstName lastName')
      await leaveBalance.populate('leaveType', 'name color code')

      const response = {
        success: true,
        message: 'Leave balance created successfully',
        data: normalizeLeaveBalance(leaveBalance)
      }

      await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'leave-balance', userId: '*' }))

      return NextResponse.json(response, { status: 201 })
    }
  } catch (error) {
    console.error('Create/Update leave balance error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create/update leave balance' },
      { status: 500 }
    )
  }
}

