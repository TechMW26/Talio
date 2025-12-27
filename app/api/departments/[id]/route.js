import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { updateDepartmentHeadsForDepartment } from '@/lib/departmentHeadSync'

// GET - Get single department
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Department } = models

    const department = await Department.findById(params.id)
      .populate('head', 'firstName lastName employeeCode designation')
      .populate('heads', 'firstName lastName employeeCode designation')

    if (!department) {
      return NextResponse.json(
        { success: false, message: 'Department not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: department,
    })
  } catch (error) {
    console.error('Get department error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch department' },
      { status: 500 }
    )
  }
}

// PUT - Update department
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Department, User, Employee } = models

    const data = await request.json()
    
    // Get current department to compare heads
    const currentDepartment = await Department.findById(params.id).lean()
    if (!currentDepartment) {
      return NextResponse.json(
        { success: false, message: 'Department not found' },
        { status: 404 }
      )
    }
    
    // Collect previous heads
    const previousHeads = []
    if (currentDepartment.head) {
      previousHeads.push(currentDepartment.head.toString())
    }
    if (currentDepartment.heads && currentDepartment.heads.length > 0) {
      currentDepartment.heads.forEach(h => {
        const hStr = h.toString()
        if (!previousHeads.includes(hStr)) {
          previousHeads.push(hStr)
        }
      })
    }
    
    // Handle multiple heads - ensure backwards compatibility
    if (data.heads && data.heads.length > 0) {
      // Set the first head as the legacy 'head' field for backwards compatibility
      data.head = data.heads[0]
    } else if (data.head && !data.heads) {
      // If only single head provided, also add to heads array
      data.heads = [data.head]
    }

    const department = await Department.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    )
      .populate('head', 'firstName lastName employeeCode designation')
      .populate('heads', 'firstName lastName employeeCode designation')

    // Collect new heads
    const newHeads = []
    if (data.head) {
      newHeads.push(data.head.toString())
    }
    if (data.heads && data.heads.length > 0) {
      data.heads.forEach(h => {
        const hStr = h.toString()
        if (!newHeads.includes(hStr)) {
          newHeads.push(hStr)
        }
      })
    }
    
    // Sync department head status to User meta (fire and forget)
    updateDepartmentHeadsForDepartment(params.id, previousHeads, newHeads, { User, Employee, Department })
      .catch(err => console.error('Error syncing department heads:', err))

    return NextResponse.json({
      success: true,
      message: 'Department updated successfully',
      data: department,
    })
  } catch (error) {
    console.error('Update department error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update department' },
      { status: 500 }
    )
  }
}

// DELETE - Delete department
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Department', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Department, User, Employee } = models

    // Get department to remove heads
    const department = await Department.findById(params.id).lean()
    if (!department) {
      return NextResponse.json(
        { success: false, message: 'Department not found' },
        { status: 404 }
      )
    }
    
    // Collect all heads to update their status
    const previousHeads = []
    if (department.head) {
      previousHeads.push(department.head.toString())
    }
    if (department.heads && department.heads.length > 0) {
      department.heads.forEach(h => {
        const hStr = h.toString()
        if (!previousHeads.includes(hStr)) {
          previousHeads.push(hStr)
        }
      })
    }

    await Department.findByIdAndDelete(params.id)
    
    // Sync department head status - remove this department from heads (fire and forget)
    if (previousHeads.length > 0) {
      updateDepartmentHeadsForDepartment(params.id, previousHeads, [], { User, Employee, Department })
        .catch(err => console.error('Error syncing department heads:', err))
    }

    return NextResponse.json({
      success: true,
      message: 'Department deleted successfully',
    })
  } catch (error) {
    console.error('Delete department error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete department' },
      { status: 500 }
    )
  }
}

