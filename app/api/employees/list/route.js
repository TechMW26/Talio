import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import queryCache from '@/lib/queryCache'

export const dynamic = 'force-dynamic'


// GET - Fetch all employees for chat
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Designation', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, User, Designation, Department } = models

    // Get URL params
    const { searchParams } = new URL(request.url)
    const includeAdmins = searchParams.get('includeAdmins') === 'true'
    const includeSelf = searchParams.get('includeSelf') === 'true'

    // Check cache first (per user)
    const userId = user._id || user.userId
    const cacheKey = queryCache.generateKey('employee-list', userId, includeAdmins ? 'all' : 'no-admin', includeSelf ? 'self' : 'no-self')
    const cached = queryCache.get(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Get current user
    const currentUserDoc = await User.findById(userId).select('employeeId role').lean()
    if (!currentUserDoc || !currentUserDoc.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Optimized: Fetch employees and users in parallel
    const employeeFilter = { status: 'active' }
    if (!includeSelf) {
      employeeFilter._id = { $ne: currentUserDoc.employeeId }
    }

    const [employees, allUsers] = await Promise.all([
      Employee.find(employeeFilter)
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

    // Filter based on includeAdmins param
    let filteredEmployees = employees
    
    // Only filter out admins if includeAdmins is false (default behavior for regular employee lists)
    // But for chat, we want ALL users to be searchable
    if (!includeAdmins) {
      const adminEmployeeIds = allUsers
        .filter(u => u.role === 'admin')
        .map(u => u.employeeId?.toString())
      
      filteredEmployees = employees.filter(emp =>
        !adminEmployeeIds.includes(emp._id.toString())
      )
    }

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

