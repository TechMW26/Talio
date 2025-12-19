import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Department from '@/models/Department'
import Employee from '@/models/Employee'
import { updateDepartmentHeadsForDepartment } from '@/lib/departmentHeadSync'

// GET - List all departments
export async function GET(request) {
  try {
    await connectDB()

    const departments = await Department.find({ isActive: true })
      .populate('head', 'firstName lastName employeeCode email designation')
      .populate('heads', 'firstName lastName employeeCode email designation')
      .sort({ name: 1 })
      .lean()

    // Add employee count for each department (including multiple departments)
    const departmentsWithCount = await Promise.all(
      departments.map(async (dept) => {
        // Count employees where this department is in their departments array OR is their primary department
        const employeeCount = await Employee.countDocuments({
          $or: [
            { departments: dept._id },
            { department: dept._id }
          ],
          status: 'active'
        })
        return {
          ...dept,
          employeeCount
        }
      })
    )

    return NextResponse.json({
      success: true,
      data: departmentsWithCount,
    })
  } catch (error) {
    console.error('Get departments error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch departments' },
      { status: 500 }
    )
  }
}

// POST - Create new department
export async function POST(request) {
  try {
    await connectDB()

    const data = await request.json()

    // Handle multiple heads - ensure backwards compatibility
    if (data.heads && data.heads.length > 0) {
      // Set the first head as the legacy 'head' field for backwards compatibility
      data.head = data.heads[0]
    } else if (data.head && !data.heads) {
      // If only single head provided, also add to heads array
      data.heads = [data.head]
    }

    const department = await Department.create(data)

    // Sync department head status to User meta (fire and forget)
    if (data.heads && data.heads.length > 0) {
      updateDepartmentHeadsForDepartment(department._id.toString(), [], data.heads)
        .catch(err => console.error('Error syncing department heads:', err));
    }

    return NextResponse.json({
      success: true,
      message: 'Department created successfully',
      data: department,
    }, { status: 201 })
  } catch (error) {
    console.error('Create department error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create department' },
      { status: 500 }
    )
  }
}

