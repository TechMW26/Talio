import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUsers } from '@/lib/pushNotification'

// PUT - Update policy
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Policy', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Policy, User, Employee } = models

    const data = await request.json()

    const policy = await Policy.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    ).populate('createdBy', 'firstName lastName')

    if (!policy) {
      return NextResponse.json(
        { success: false, message: 'Policy not found' },
        { status: 404 }
      )
    }

    // Send push notification to relevant users about policy update
    try {
      let targetUserIds = []

      if (policy.applicableTo === 'all') {
        const allUsers = await User.find({}).select('_id')
        targetUserIds = allUsers.map(u => u._id.toString())
      } else if (policy.applicableTo === 'department' && policy.department) {
        const deptEmployees = await Employee.find({
          department: policy.department,
          status: 'active'
        }).select('_id')

        const employeeIds = deptEmployees.map(e => e._id.toString())
        const users = await User.find({
          employeeId: { $in: employeeIds }
        }).select('_id')

        targetUserIds = users.map(u => u._id.toString())
      } else if (policy.applicableTo === 'specific' && policy.specificEmployees && policy.specificEmployees.length > 0) {
        const employeeIds = policy.specificEmployees.map(e => e.toString())
        const users = await User.find({
          employeeId: { $in: employeeIds }
        }).select('_id')

        targetUserIds = users.map(u => u._id.toString())
      }

      if (targetUserIds.length > 0) {
        await sendPushToUsers(
          targetUserIds,
          {
            title: '📋 Policy Updated',
            body: `${policy.title} has been updated - Please review`
          },
          {
            url: '/dashboard/policies',
            type: 'policy_update',
            data: {
              policyId: policy._id.toString()
            }
          }
        )

        console.log(`Policy update notification sent to ${targetUserIds.length} user(s)`)
      }
    } catch (notifError) {
      console.error('Failed to send policy update notification:', notifError)
    }

    return NextResponse.json({
      success: true,
      message: 'Policy updated successfully',
      data: policy,
    })
  } catch (error) {
    console.error('Update policy error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update policy' },
      { status: 500 }
    )
  }
}

// DELETE - Delete policy
export async function DELETE(request, { params }) {
  try {
    const policy = await Policy.findByIdAndDelete(params.id)

    if (!policy) {
      return NextResponse.json(
        { success: false, message: 'Policy not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Policy deleted successfully',
    })
  } catch (error) {
    console.error('Delete policy error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete policy' },
      { status: 500 }
    )
  }
}

