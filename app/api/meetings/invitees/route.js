import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'

// GET - Get employees grouped by department for meeting invitations
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
    const auth = await getAuthAndModels(request, ['Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Department } = models

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    // Get all active departments
    const departments = await Department.find({ isActive: { $ne: false } })
      .select('name code')
      .sort({ name: 1 })
      .lean()

    // Get all active employees
    let employeeQuery = { status: 'active' }
    
    if (search) {
      employeeQuery.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    }

    const employees = await Employee.find(employeeQuery)
      .select('firstName lastName email profilePicture department departments designation')
      .populate('department', 'name code')
      .populate('departments', 'name code')
      .populate('designation', 'title')
      .sort({ firstName: 1, lastName: 1 })
      .lean()

    // Group employees by department
    const departmentGroups = []

    for (const dept of departments) {
      const deptEmployees = employees.filter(emp => {
        // Check both single department and multiple departments
        const inSingleDept = emp.department?._id?.toString() === dept._id.toString()
        const inMultipleDepts = emp.departments?.some(d => d._id?.toString() === dept._id.toString())
        return inSingleDept || inMultipleDepts
      })

      if (deptEmployees.length > 0) {
        departmentGroups.push({
          department: {
            _id: dept._id,
            name: dept.name,
            code: dept.code
          },
          employees: deptEmployees.map(emp => ({
            _id: emp._id,
            firstName: emp.firstName,
            lastName: emp.lastName,
            fullName: `${emp.firstName} ${emp.lastName}`,
            email: emp.email,
            profilePicture: emp.profilePicture,
            designation: emp.designation?.title || 'Employee'
          })),
          count: deptEmployees.length
        })
      }
    }

    // Add employees without department
    const noDeptEmployees = employees.filter(emp => 
      !emp.department && (!emp.departments || emp.departments.length === 0)
    )

    if (noDeptEmployees.length > 0) {
      departmentGroups.push({
        department: {
          _id: 'no-department',
          name: 'No Department',
          code: 'NONE'
        },
        employees: noDeptEmployees.map(emp => ({
          _id: emp._id,
          firstName: emp.firstName,
          lastName: emp.lastName,
          fullName: `${emp.firstName} ${emp.lastName}`,
          email: emp.email,
          profilePicture: emp.profilePicture,
          designation: emp.designation?.title || 'Employee'
        })),
        count: noDeptEmployees.length
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        departmentGroups,
        totalEmployees: employees.length,
        totalDepartments: departmentGroups.length
      }
    })
  } catch (error) {
    console.error('Get department employees error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
