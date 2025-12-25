import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'


// GET - Check if user is a department head
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

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Department, User, Employee } = models

    // Get user's employee ID
    const user = await User.findById(decoded.userId).select('employeeId')

    let employeeId = user?.employeeId;
    
    // If user doesn't have employeeId directly, try to find employee by userId
    if (!employeeId) {
      const employee = await Employee.findOne({ userId: decoded.userId }).select('_id');
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

    // Check if user is a department head (via Department.head or Department.heads[] field)
    const department = await Department.findOne({ 
      $or: [
        { head: employeeId },
        { heads: employeeId }
      ],
      isActive: true 
    }).select('name code _id')

    console.log('[Check Head API] Result:', { 
      userId: decoded.userId, 
      employeeId: employeeId?.toString(), 
      isDepartmentHead: !!department,
      departmentId: department?._id?.toString(),
      departmentName: department?.name
    });

    return NextResponse.json({
      success: true,
      isDepartmentHead: !!department,
      department: department || null,
      departmentId: department?._id || null,
      departmentName: department?.name || null
    })
  } catch (error) {
    console.error('Check department head error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

