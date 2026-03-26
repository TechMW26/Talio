import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPolicyNotification } from '@/lib/notificationService'
import { emitPolicyUpdate } from '@/lib/realtimeEvents'

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

    let policies = await Policy.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('companies', 'name code')
      .populate('departments', 'name code')
      .sort({ createdAt: -1 })

    // For non-admin/hr users, filter to only show applicable policies
    if (!['admin', 'hr'].includes(user.role)) {
      const employee = await Employee.findById(user.employeeId || user._id).select('company department departments')
      if (employee) {
        const empCompany = employee.company?.toString()
        const empDepts = [employee.department, ...(employee.departments || [])].filter(Boolean).map(d => d.toString())

        policies = policies.filter(policy => {
          if (policy.applicableTo === 'all') return true
          if (policy.applicableTo === 'specific') {
            return policy.specificEmployees?.some(id => id.toString() === (user.employeeId || user._id))
          }
          if (policy.applicableTo === 'company') {
            const companyIds = (policy.companies || []).map(c => (c._id || c).toString())
            const deptIds = (policy.departments || []).map(d => (d._id || d).toString())
            const matchesCompany = companyIds.length === 0 || (empCompany && companyIds.includes(empCompany))
            const matchesDept = deptIds.length === 0 || empDepts.some(d => deptIds.includes(d))
            return matchesCompany && matchesDept
          }
          if (policy.applicableTo === 'department') {
            const deptIds = (policy.departments || []).map(d => (d._id || d).toString())
            if (deptIds.length > 0) {
              return empDepts.some(d => deptIds.includes(d))
            }
            // Legacy single department field
            return policy.department && empDepts.includes(policy.department.toString())
          }
          return true
        })
      }
    }

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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Policy', 'User', 'Employee', 'Company', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, user } = auth
    const { Policy, User, Employee, Company, Department } = models

    // Only admin and HR can create policies
    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Only admin and HR can create policies' }, { status: 403 })
    }

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
      } else if (policy.applicableTo === 'company') {
        // Company-specific (optionally filtered by departments)
        const empQuery = { status: 'active' }
        if (policy.companies && policy.companies.length > 0) {
          empQuery.company = { $in: policy.companies }
        }
        if (policy.departments && policy.departments.length > 0) {
          empQuery.$or = [
            { department: { $in: policy.departments } },
            { departments: { $elemMatch: { $in: policy.departments } } }
          ]
        }
        const matchedEmployees = await Employee.find(empQuery).select('_id')
        const employeeIds = matchedEmployees.map(e => e._id.toString())
        const users = await User.find({ employeeId: { $in: employeeIds } }).select('_id')
        targetUserIds = users.map(u => u._id.toString())
      } else if (policy.applicableTo === 'department') {
        // Department-specific
        const deptIds = (policy.departments && policy.departments.length > 0)
          ? policy.departments
          : (policy.department ? [policy.department] : [])
        if (deptIds.length > 0) {
          const deptEmployees = await Employee.find({
            $or: [
              { department: { $in: deptIds } },
              { departments: { $elemMatch: { $in: deptIds } } }
            ],
            status: 'active'
          }).select('_id')
          const employeeIds = deptEmployees.map(e => e._id.toString())
          const users = await User.find({ employeeId: { $in: employeeIds } }).select('_id')
          targetUserIds = users.map(u => u._id.toString())
        }
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

    // Emit real-time event for policy updates
    emitPolicyUpdate(populatedPolicy.toObject ? populatedPolicy.toObject() : populatedPolicy, { action: 'create' })

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

