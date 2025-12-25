import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPolicyNotification } from '@/lib/notificationService'

// GET - List policies
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Policy', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Policy, User, Employee } = models

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')

    const query = {}

    if (category) {
      query.category = category
    }

    const policies = await Policy.find(query)
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: policies,
    })
  } catch (error) {
    console.error('Get policies error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch policies' },
      { status: 500 }
    )
  }
}

// POST - Create policy
export async function POST(request) {
  try {
    const data = await request.json()

    const policy = await Policy.create(data)

    const populatedPolicy = await Policy.findById(policy._id)
      .populate('createdBy', 'firstName lastName')

    // Send push notification to relevant users
    try {
      let targetUserIds = []

      if (policy.applicableTo === 'all') {
        // Send to all users
        const allUsers = await User.find({}).select('_id')
        targetUserIds = allUsers.map(u => u._id.toString())
      } else if (policy.applicableTo === 'department' && policy.department) {
        // Send to department users
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
        // Send to specific employees
        const employeeIds = policy.specificEmployees.map(e => e.toString())
        const users = await User.find({
          employeeId: { $in: employeeIds }
        }).select('_id')

        targetUserIds = users.map(u => u._id.toString())
      }

      if (targetUserIds.length > 0) {
        // Get creator user ID
        const creatorEmployee = await Employee.findById(data.createdBy).select('userId')
        const creatorUserId = creatorEmployee?.userId

        // Send Firebase notification
        await sendPolicyNotification({
          policyId: policy._id.toString(),
          title: policy.title,
          targetUserIds,
          createdBy: creatorUserId
        })

        console.log(`Firebase policy notification sent to ${targetUserIds.length} user(s)`)
      }
    } catch (notifError) {
      console.error('Failed to send policy notification:', notifError)
      // Don't fail the request if notification fails
    }

    return NextResponse.json({
      success: true,
      message: 'Policy created successfully',
      data: populatedPolicy,
    }, { status: 201 })
  } catch (error) {
    console.error('Create policy error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create policy' },
      { status: 500 }
    )
  }
}

