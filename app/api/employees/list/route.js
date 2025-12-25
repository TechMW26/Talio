import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'


// GET - Fetch all employees for chat
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Check cache first (per user)
    const cacheKey = queryCache.generateKey('employee-list', decoded.userId)
    const cached = queryCache.get(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Designation', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, User, Designation, Department } = models

    // Get current user
    const currentUserDoc = await User.findById(decoded.userId).select('employeeId role').lean()
    if (!currentUserDoc || !currentUserDoc.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Optimized: Fetch employees and users in parallel
    const [employees, allUsers] = await Promise.all([
      Employee.find({
        _id: { $ne: currentUserDoc.employeeId },
        status: 'active'
      })
        .select('firstName lastName employeeCode profilePicture email designation designationLevel designationLevelName department')
        .populate({
          path: 'designation',
          select: 'title levelName',
          options: { lean: true }
        })
        .populate({
          path: 'department',
          select: 'name',
          options: { lean: true }
        })
        .sort({ firstName: 1 })
        .lean(),

      User.find({ isActive: true }).select('employeeId role').lean()
    ])

    const adminEmployeeIds = allUsers
      .filter(u => u.role === 'admin')
      .map(u => u.employeeId?.toString())

    // Filter out admin users
    const filteredEmployees = employees.filter(emp =>
      !adminEmployeeIds.includes(emp._id.toString())
    )

    const response = {
      success: true,
      data: filteredEmployees
    }

    // Cache for 60 seconds
    queryCache.set(cacheKey, response, 60000)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Get employees error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

