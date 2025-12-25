import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'

// GET - Get leave balances
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['LeaveBalance', 'Employee', 'LeaveType'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { LeaveBalance, Employee, LeaveType } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const year = parseInt(searchParams.get('year')) || new Date().getFullYear()

    // If employeeId is provided, get balance for specific employee
    if (employeeId) {
      const leaveBalances = await LeaveBalance.find({
        employee: employeeId,
        year: year
      }).populate('leaveType', 'name color code')

      return NextResponse.json({
        success: true,
        data: leaveBalances,
      })
    }

    // If no employeeId and user is admin/hr, get all balances
    if (['admin', 'hr'].includes(decoded.role)) {
      const leaveBalances = await LeaveBalance.find({ year: year })
        .populate('employee', 'employeeCode firstName lastName email department')
        .populate('leaveType', 'name color code')
        .sort({ 'employee.employeeCode': 1 })

      return NextResponse.json({
        success: true,
        data: leaveBalances,
      })
    }

    // For regular employees, get their own balance
    const employee = await Employee.findOne({ _id: decoded.userId })
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const leaveBalances = await LeaveBalance.find({
      employee: employee._id,
      year: year
    }).populate('leaveType', 'name color code')

    return NextResponse.json({
      success: true,
      data: leaveBalances,
    })
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
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Only admin/hr can create/update leave balances
    if (!['admin', 'hr'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { employee, leaveType, totalDays, year } = body

    // Validate required fields
    if (!employee || !leaveType || !totalDays || !year) {
      return NextResponse.json(
        { success: false, message: 'Employee, leave type, total days, and year are required' },
        { status: 400 }
      )
    }

    // Check if balance already exists
    const existingBalance = await LeaveBalance.findOne({
      employee,
      leaveType,
      year
    })

    if (existingBalance) {
      // Update existing balance
      existingBalance.totalDays = totalDays
      existingBalance.remainingDays = totalDays - existingBalance.usedDays
      await existingBalance.save()

      await existingBalance.populate('employee', 'employeeCode firstName lastName')
      await existingBalance.populate('leaveType', 'name color code')

      return NextResponse.json({
        success: true,
        message: 'Leave balance updated successfully',
        data: existingBalance
      })
    } else {
      // Create new balance
      const leaveBalance = new LeaveBalance({
        employee,
        leaveType,
        totalDays,
        usedDays: 0,
        remainingDays: totalDays,
        year
      })

      await leaveBalance.save()

      await leaveBalance.populate('employee', 'employeeCode firstName lastName')
      await leaveBalance.populate('leaveType', 'name color code')

      return NextResponse.json({
        success: true,
        message: 'Leave balance created successfully',
        data: leaveBalance
      }, { status: 201 })
    }
  } catch (error) {
    console.error('Create/Update leave balance error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create/update leave balance' },
      { status: 500 }
    )
  }
}

