import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'
import { emitPayrollUpdate, REALTIME_EVENTS } from '@/lib/realtimeEvents'

// GET - List payroll records
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Payroll'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Payroll } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const month = searchParams.get('month')
    const year = searchParams.get('year')

    const query = {}

    if (employeeId) {
      query.employee = employeeId
    }

    if (month && year) {
      query.month = parseInt(month)
      query.year = parseInt(year)
    }

    const payrolls = await Payroll.find(query)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeCode bankDetails company designationLevel designation',
        populate: [
          {
            path: 'company',
            select: 'name code'
          },
          {
            path: 'designation',
            select: 'title level'
          }
        ]
      })
      .sort({ year: -1, month: -1 })

    return NextResponse.json({
      success: true,
      data: payrolls,
    })
  } catch (error) {
    console.error('Get payroll error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch payroll' },
      { status: 500 }
    )
  }
}

// POST - Generate payroll
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Payroll', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Payroll, Employee } = models

    const data = await request.json()

    // Check if payroll already exists for this employee and month
    const existingPayroll = await Payroll.findOne({
      employee: data.employee,
      month: data.month,
      year: data.year,
    })

    if (existingPayroll) {
      return NextResponse.json(
        { success: false, message: 'Payroll already exists for this month' },
        { status: 400 }
      )
    }

    // Use pre-calculated totals if provided, otherwise calculate
    let grossSalary = data.grossSalary
    let totalDeductions = data.totalDeductions
    let netSalary = data.netSalary

    // Handle deductions - could be a number (new format) or object (old format)
    if (typeof data.deductions === 'object' && data.deductions !== null) {
      totalDeductions = Object.values(data.deductions).reduce((sum, val) => sum + (parseFloat(val) || 0), 0)
    } else if (typeof data.deductions === 'number') {
      totalDeductions = data.deductions
    }

    // Handle earnings - could be a number or object
    if (!grossSalary) {
      if (typeof data.earnings === 'object' && data.earnings !== null) {
        grossSalary = Object.values(data.earnings).reduce((sum, val) => sum + (parseFloat(val) || 0), 0)
      } else if (data.basic !== undefined) {
        // New format: basic + allowances
        grossSalary = (parseFloat(data.basic) || 0) + (parseFloat(data.allowances) || 0)
      }
    }

    // Calculate net salary if not provided
    if (!netSalary && grossSalary !== undefined && totalDeductions !== undefined) {
      netSalary = grossSalary - totalDeductions
    }

    // Ensure required fields have defaults
    const payrollData = {
      ...data,
      grossSalary: grossSalary || 0,
      totalDeductions: totalDeductions || 0,
      netSalary: netSalary || 0,
      workingDays: data.workingDays || 26,
      presentDays: data.presentDays || 0,
      absentDays: data.absentDays || 0,
      leaveDays: data.leaveDays || 0,
      status: data.status === 'pending' ? 'draft' : (data.status || 'draft'), // Map 'pending' to 'draft'
    }

    const payroll = await Payroll.create(payrollData)

    const populatedPayroll = await Payroll.findById(payroll._id)
      .populate('employee', 'firstName lastName employeeCode')

    // Emit Socket.IO event for payroll generation
    try {
      const io = global.io
      if (io) {
        const employeeDoc = await Employee.findById(data.employee).select('userId')
        const employeeUserId = employeeDoc?.userId

        if (employeeUserId) {
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const monthName = monthNames[data.month - 1]

          // Socket.IO event
          io.to(`user:${employeeUserId}`).emit('payroll-update', {
            payroll: populatedPayroll,
            action: 'generated',
            message: `Your payroll for ${monthName} ${data.year} has been generated`,
            timestamp: new Date()
          })
          console.log(`✅ [Socket.IO] Payroll generation sent to user:${employeeUserId}`)

          // Emit standardized real-time event for dashboard updates
          emitPayrollUpdate(populatedPayroll.toObject ? populatedPayroll.toObject() : populatedPayroll, [employeeUserId], { action: 'create' })

          // FCM push notification
          try {
            await sendPushToUser(
              employeeUserId,
              {
                title: '💰 Payroll Generated',
                body: `Your payroll for ${monthName} ${data.year} has been generated`,
              },
              {
                clickAction: '/dashboard/payroll',
                eventType: 'payroll_update',
                data: {
                  payrollId: payroll._id.toString(),
                  month: data.month,
                  year: data.year,
                  type: 'payroll_generation'
                }
              }
            )
            console.log(`📲 [FCM] Payroll notification sent to user:${employeeUserId}`)
          } catch (fcmError) {
            console.error('Failed to send payroll FCM notification:', fcmError)
          }
        }
      }
    } catch (socketError) {
      console.error('Failed to send payroll socket notification:', socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Payroll generated successfully',
      data: populatedPayroll,
    }, { status: 201 })
  } catch (error) {
    console.error('Generate payroll error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to generate payroll' },
      { status: 500 }
    )
  }
}

