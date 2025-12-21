import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import PerformanceGoal from '@/models/PerformanceGoal'
import Employee from '@/models/Employee'
import { verifyToken } from '@/lib/auth'

// GET - Fetch performance goals
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const goalId = searchParams.get('goalId')
    
    // If goalId is provided, return single goal
    if (goalId) {
      const goal = await PerformanceGoal.findById(goalId)
        .populate('employee', 'firstName lastName employeeCode email department profileImage position')
        .populate('createdBy', 'firstName lastName employeeCode')
        .populate('department', 'name')
        .lean()

      if (!goal) {
        return NextResponse.json({ success: false, message: 'Goal not found' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        data: {
          ...goal,
          isOverdue: goal.status !== 'completed' && goal.status !== 'cancelled' && new Date(goal.dueDate) < new Date(),
          daysRemaining: Math.ceil((new Date(goal.dueDate) - new Date()) / (1000 * 60 * 60 * 24))
        }
      })
    }

    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')
    const department = searchParams.get('department')
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 50

    // Build query based on role
    let query = {}

    // Role-based filtering
    if (decoded.role === 'employee') {
      // Employees can only see their own goals
      const employee = await Employee.findOne({ userId: decoded.userId }).select('_id')
      if (employee) {
        query.employee = employee._id
      } else {
        return NextResponse.json({ success: true, data: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } })
      }
    } else if (decoded.role === 'manager' || decoded.role === 'department_head') {
      // Managers can see goals for their team members
      const manager = await Employee.findOne({ userId: decoded.userId }).select('_id department')
      if (manager && manager.department) {
        const teamMembers = await Employee.find({ 
          $or: [
            { department: manager.department },
            { reportingManager: manager._id }
          ]
        }).select('_id')
        query.employee = { $in: teamMembers.map(e => e._id) }
      }
    }

    // Apply additional filters
    if (employeeId) {
      query.employee = employeeId
    }
    if (status) {
      query.status = status
    }
    if (department) {
      query.department = department
    }

    // Build the query
    let goalsQuery = PerformanceGoal.find(query)
      .populate('employee', 'firstName lastName employeeCode email department profileImage')
      .populate('createdBy', 'firstName lastName employeeCode')
      .populate('department', 'name')
      .sort({ createdAt: -1 })

    // Pagination
    const skip = (page - 1) * limit
    const totalItems = await PerformanceGoal.countDocuments(query)
    const totalPages = Math.ceil(totalItems / limit)

    const goals = await goalsQuery.skip(skip).limit(limit).lean()

    // Add computed fields
    const goalsWithComputed = goals.map(goal => ({
      ...goal,
      isOverdue: goal.status !== 'completed' && goal.status !== 'cancelled' && new Date(goal.dueDate) < new Date(),
      daysRemaining: Math.ceil((new Date(goal.dueDate) - new Date()) / (1000 * 60 * 60 * 24))
    }))

    return NextResponse.json({
      success: true,
      data: goalsWithComputed,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit
      }
    })

  } catch (error) {
    console.error('Get performance goals error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Create new performance goal
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    if (!['admin', 'hr', 'manager', 'department_head'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()
    const {
      employeeId,
      title,
      description,
      category,
      priority,
      status,
      progress,
      startDate,
      dueDate,
      milestones,
      keyResults,
      weightage,
      alignedTo,
      tags
    } = body

    if (!employeeId || !title || !dueDate) {
      return NextResponse.json(
        { success: false, message: 'Employee ID, title, and due date are required' },
        { status: 400 }
      )
    }

    const targetEmployee = await Employee.findById(employeeId).select('_id department')
    if (!targetEmployee) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    const creator = await Employee.findOne({ userId: decoded.userId }).select('_id')
    if (!creator) {
      return NextResponse.json(
        { success: false, message: 'Creator employee profile not found' },
        { status: 404 }
      )
    }

    const newGoal = await PerformanceGoal.create({
      employee: employeeId,
      title,
      description: description || '',
      category: category || 'General',
      priority: priority || 'medium',
      status: status || 'not-started',
      progress: progress || 0,
      startDate: startDate || new Date(),
      dueDate,
      milestones: (milestones || []).filter(m => m.title?.trim()),
      keyResults: keyResults || [],
      weightage: weightage || 10,
      alignedTo: alignedTo || 'individual',
      tags: tags || [],
      createdBy: creator._id,
      department: targetEmployee.department
    })

    const populatedGoal = await PerformanceGoal.findById(newGoal._id)
      .populate('employee', 'firstName lastName employeeCode email')
      .populate('createdBy', 'firstName lastName')
      .populate('department', 'name')
      .lean()

    return NextResponse.json({
      success: true,
      message: 'Performance goal created successfully',
      data: populatedGoal
    }, { status: 201 })

  } catch (error) {
    console.error('Create performance goal error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// PUT - Update performance goal
export async function PUT(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const body = await request.json()
    const { goalId, ...updateData } = body

    if (!goalId) {
      return NextResponse.json(
        { success: false, message: 'Goal ID is required' },
        { status: 400 }
      )
    }

    const goal = await PerformanceGoal.findById(goalId)
    if (!goal) {
      return NextResponse.json(
        { success: false, message: 'Goal not found' },
        { status: 404 }
      )
    }

    const canUpdateAll = ['admin', 'hr', 'manager', 'department_head'].includes(decoded.role)
    const employee = await Employee.findOne({ userId: decoded.userId }).select('_id')

    if (!canUpdateAll) {
      if (!employee || goal.employee.toString() !== employee._id.toString()) {
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
      const allowedFields = ['progress', 'status', 'updates']
      Object.keys(updateData).forEach(key => {
        if (!allowedFields.includes(key)) {
          delete updateData[key]
        }
      })
    }

    if (updateData.progress === 100 && goal.status !== 'completed') {
      updateData.status = 'completed'
      updateData.completedAt = new Date()
    }

    if (updateData.milestones) {
      updateData.milestones = updateData.milestones.map(m => ({
        ...m,
        completedAt: m.completed && !m.completedAt ? new Date() : m.completedAt
      }))
    }

    const updatedGoal = await PerformanceGoal.findByIdAndUpdate(
      goalId,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate('employee', 'firstName lastName employeeCode email')
      .populate('createdBy', 'firstName lastName')
      .populate('department', 'name')
      .lean()

    return NextResponse.json({
      success: true,
      message: 'Performance goal updated successfully',
      data: updatedGoal
    })

  } catch (error) {
    console.error('Update performance goal error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE - Delete performance goal
export async function DELETE(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    const decoded = await verifyToken(token)
    
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    if (!['admin', 'hr', 'manager', 'department_head'].includes(decoded.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const goalId = searchParams.get('goalId')

    if (!goalId) {
      return NextResponse.json(
        { success: false, message: 'Goal ID is required' },
        { status: 400 }
      )
    }

    const goal = await PerformanceGoal.findById(goalId)
    if (!goal) {
      return NextResponse.json(
        { success: false, message: 'Goal not found' },
        { status: 404 }
      )
    }

    await PerformanceGoal.findByIdAndDelete(goalId)

    return NextResponse.json({
      success: true,
      message: 'Performance goal deleted successfully'
    })

  } catch (error) {
    console.error('Delete performance goal error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
