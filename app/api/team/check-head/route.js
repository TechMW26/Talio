import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { buildCacheKey, getCache, setCache } from '@/lib/cache'
export const dynamic = 'force-dynamic'


// GET - Check if user is a department head
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
  const { user, models, tenant } = auth
    const { Department, Employee } = models

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

    // Check if user is a department head (via Department.head or Department.heads[] field)
    const department = await Department.findOne({ 
      $or: [
        { head: employeeId },
        { heads: employeeId }
      ],
      isActive: true 
    }).select('name code _id')

    console.log('[Check Head API] Result:', { 
      userId: user._id, 
      employeeId: employeeId?.toString(), 
      isDepartmentHead: !!department,
      departmentId: department?._id?.toString(),
      departmentName: department?.name
    });

    const response = {
      success: true,
      isDepartmentHead: !!department,
      department: department || null,
      departmentId: department?._id || null,
      departmentName: department?.name || null
    }

    await setCache(cacheKey, response, 10 * 60)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Check department head error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

