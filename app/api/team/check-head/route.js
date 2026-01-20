import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
export const dynamic = 'force-dynamic'


// GET - Check if user is a department head
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
  const { user, models, tenant } = auth
    const { Department, Employee, User } = models

    // Get user's employee ID from auth
    let employeeId = user?.employeeId?._id || user?.employeeId;
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employeeId) {
      const employee = await Employee.findOne({ userId: user._id }).select('_id');
      employeeId = employee?._id;
    }

    if (!employeeId) {
      return NextResponse.json({ 
        success: true, 
        isDepartmentHead: false,
        departments: [],
        department: null,
        departmentId: null,
        message: 'Employee not found' 
      })
    }

    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: user.role,
      userId: user._id || user.userId,
      namespace: 'permissions:department-head'
    })

    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Get user record to check headOfDepartments (supports multiple departments)
    const userRecord = await User.findById(user._id || user.userId)
      .select('isDepartmentHead headOfDepartments')
      .lean()

    let departments = []

    // First check User.headOfDepartments (supports multiple departments)
    if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
      departments = await Department.find({
        _id: { $in: userRecord.headOfDepartments },
        isActive: true
      }).select('name code _id').lean()
    }

    // Fallback: Check Department.head or Department.heads
    if (departments.length === 0) {
      departments = await Department.find({ 
        $or: [
          { head: employeeId },
          { heads: employeeId }
        ],
        isActive: true 
      }).select('name code _id').lean()
    }

    console.log('[Check Head API] Result:', { 
      userId: user._id, 
      employeeId: employeeId?.toString(), 
      isDepartmentHead: departments.length > 0,
      departmentCount: departments.length,
      departmentNames: departments.map(d => d.name).join(', ')
    });

    const response = {
      success: true,
      isDepartmentHead: departments.length > 0,
      departments: departments,
      // Backward compatibility - return first department
      department: departments[0] || null,
      departmentId: departments[0]?._id || null,
      departmentName: departments[0]?.name || null
    }

    await setCache(cacheKey, response, 10 * 60)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Check department head error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

