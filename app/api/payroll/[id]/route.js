import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - Get single payroll
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Payroll', 'Company'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Payroll, Company } = models

    const payroll = await Payroll.findById(params.id)
      .populate({
        path: 'employee',
        select: 'firstName lastName employeeCode company',
        populate: {
          path: 'company',
          select: 'name logo address'
        }
      })

    if (!payroll) {
      return NextResponse.json(
        { success: false, message: 'Payroll record not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: payroll,
    })
  } catch (error) {
    console.error('Get payroll error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch payroll record' },
      { status: 500 }
    )
  }
}

// PUT - Update payroll
export async function PUT(request, { params }) {
  try {
    const data = await request.json()

    const payroll = await Payroll.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    ).populate('employee', 'firstName lastName employeeCode')

    if (!payroll) {
      return NextResponse.json(
        { success: false, message: 'Payroll record not found' },
        { status: 404 }
      )
    }

    // Emit Socket.IO event for payroll status updates
    try {
      const io = global.io
      if (io && data.status) {
        const Employee = require('@/models/Employee').default
        const employeeDoc = await Employee.findById(payroll.employee._id || payroll.employee).select('userId')
        const employeeUserId = employeeDoc?.userId

        if (employeeUserId) {
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
          const monthName = monthNames[payroll.month - 1]
          const icon = data.status === 'processed' ? '✅' : '💵'

          // Socket.IO event
          io.to(`user:${employeeUserId}`).emit('payroll-update', {
            payroll,
            action: data.status === 'processed' ? 'processed' : 'updated',
            message: `Your payroll for ${monthName} ${payroll.year} has been ${data.status}`,
            timestamp: new Date()
          })
          console.log(`✅ [Socket.IO] Payroll update sent to user:${employeeUserId}`)

          // FCM push notification
          try {
            const { sendPushToUser } = require('@/lib/pushNotification')
            await sendPushToUser(
              employeeUserId,
              {
                title: `${icon} Payroll ${data.status === 'processed' ? 'Processed' : 'Updated'}`,
                body: `Your payroll for ${monthName} ${payroll.year} has been ${data.status}`,
              },
              {
                clickAction: '/dashboard/payroll',
                eventType: 'payroll_update',
                data: {
                  payrollId: payroll._id.toString(),
                  status: data.status,
                  type: 'payroll_status_update'
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
      message: 'Payroll updated successfully',
      data: payroll,
    })
  } catch (error) {
    console.error('Update payroll error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update payroll' },
      { status: 500 }
    )
  }
}

// DELETE - Delete payroll
export async function DELETE(request, { params }) {
  try {
    const payroll = await Payroll.findByIdAndDelete(params.id)

    if (!payroll) {
      return NextResponse.json(
        { success: false, message: 'Payroll record not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Payroll deleted successfully',
    })
  } catch (error) {
    console.error('Delete payroll error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete payroll' },
      { status: 500 }
    )
  }
}

// PATCH - Partial update payroll (alias to PUT)
export async function PATCH(request, { params }) {
  return PUT(request, { params })
}

