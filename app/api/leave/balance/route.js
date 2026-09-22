import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { EMPLOYED_STATUSES, ensureEmployeeLeaveBalances } from '@/lib/leaveAllocation.server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, buildCachePattern, clearCachePattern, getCache, setCache } from '@/lib/cache'
import {
  buildLeaveBalanceFields,
  normalizeLeaveBalance,
  normalizeLeaveBalances,
} from '@/lib/leaveData'

// GET - Get balances only within the actor's authorized employee scope.
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['LeaveBalance', 'Employee', 'LeaveType'])
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    const { user, models, tenant } = auth
    const { LeaveBalance, Employee } = models
    const { searchParams } = new URL(request.url)
    const requestedEmployee = searchParams.get('employeeId')
    const rawYear = searchParams.get('year')
    const year = rawYear === null ? new Date().getFullYear() : Number(rawYear)
    if (!Number.isInteger(year) || year < 1900 || year > 9998
      || (requestedEmployee && !mongoose.Types.ObjectId.isValid(requestedEmployee))) {
      return NextResponse.json({ success: false, message: 'Invalid employee or leave year' }, { status: 400 })
    }
    const canViewAll = ['admin', 'super_admin', 'hr'].includes(user.role)
    let ownId = String(user.employeeId?._id || user.employeeId || '')
    if (!canViewAll && !ownId) {
      const ownEmployee = await Employee.findOne({ userId: user._id || user.userId }).select('_id').lean()
      ownId = String(ownEmployee?._id || '')
    }
    if (!canViewAll && requestedEmployee && requestedEmployee !== ownId) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }
    const employeeId = requestedEmployee || (!canViewAll ? ownId : null)
    if (!canViewAll && !employeeId) return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    const cacheKey = buildCacheKey({
      tenantId: tenant.databaseName, role: user.role, userId: user._id || user.userId,
      namespace: 'leave-balance', params: { employeeId, year, formatVersion: 3 },
    })
    const cached = await getCache(cacheKey)
    if (cached) return NextResponse.json(cached)
    let employeeFilter
    if (employeeId) {
      await ensureEmployeeLeaveBalances({ models, employeeId, year })
      employeeFilter = employeeId
    } else {
      const eligible = await Employee.find({ status: { $in: EMPLOYED_STATUSES } }).select('_id').lean()
      employeeFilter = { $in: eligible.map(employee => employee._id) }
    }
    const balances = await LeaveBalance.find({ employee: employeeFilter, year })
      .populate('employee', 'employeeCode firstName lastName email department')
      .populate('leaveType', 'name color code').lean()
    const response = { success: true, data: normalizeLeaveBalances(balances) }
    await setCache(cacheKey, response, 60)
    return NextResponse.json(response)
  } catch (error) {
    console.error('Get leave balance error:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch leave balance' }, { status: 500 })
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
    if (!['admin', 'super_admin', 'hr'].includes(user.role)) {
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

