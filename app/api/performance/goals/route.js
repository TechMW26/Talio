import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET - Fetch performance goals
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['PerformanceGoal', 'Employee', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { PerformanceGoal, Employee, Team } = models

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
    const departments = searchParams.get('departments') // Comma-separated list of department IDs
    const teamFilter = searchParams.get('team')
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 50

    // Build query based on role
    let query = {}

    // Role-based filtering
    const userId = user._id || user.userId
    if (user.role === 'employee') {
      // Employees can only see their own goals
      const employee = await Employee.findOne({ userId }).select('_id')
      if (employee) {
        query.employee = employee._id
      } else {
        return NextResponse.json({ success: true, data: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } })
      }
    } else if (user.role === 'manager' || user.role === 'department_head') {
      // Managers can see goals for their team members
      const manager = await Employee.findOne({ userId }).select('_id department')
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
    // Support multiple departments filter (comma-separated)
    if (departments) {
      const deptIds = departments.split(',').filter(id => id.trim())
      if (deptIds.length > 0) {
        query.department = { $in: deptIds }
      }
    } else if (department && department !== 'all') {
      query.department = department
    }

    // Apply team filter
    if (teamFilter && teamFilter !== 'all' && Team) {
      const team = await Team.findById(teamFilter).select('members teamLeaders').lean()
      if (team) {
        const teamMemberIds = [
          ...(team.members || []),
          ...(team.teamLeaders || [])
        ]
        // Intersect with existing employee filter if present
        if (query.employee?.$in) {
          const teamIdSet = new Set(teamMemberIds.map(id => id.toString()))
          query.employee = { $in: query.employee.$in.filter(id => teamIdSet.has(id.toString())) }
        } else if (!query.employee) {
          query.employee = { $in: teamMemberIds }
        }
      }
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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['PerformanceGoal', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { PerformanceGoal, Employee } = models

    if (!['admin', 'hr', 'manager', 'department_head'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

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

    // Validate status value
    const validStatuses = ['not-started', 'in-progress', 'on-hold', 'completed', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, message: `Invalid status. Allowed values: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate priority value
    const validPriorities = ['low', 'medium', 'high', 'critical']
    if (priority && !validPriorities.includes(priority)) {
      return NextResponse.json(
        { success: false, message: `Invalid priority. Allowed values: ${validPriorities.join(', ')}` },
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

    const creator = await Employee.findOne({ userId: user._id }).select('_id')
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
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message)
      return NextResponse.json(
        { success: false, message: messages.join('. ') },
        { status: 400 }
      )
    }
    if (error.name === 'CastError') {
      return NextResponse.json(
        { success: false, message: 'Invalid data format provided' },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { success: false, message: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}

// PUT - Update performance goal
export async function PUT(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['PerformanceGoal', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { PerformanceGoal, Employee } = models

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

    // Validate status if being updated
    const validStatuses = ['not-started', 'in-progress', 'on-hold', 'completed', 'cancelled']
    if (updateData.status && !validStatuses.includes(updateData.status)) {
      return NextResponse.json(
        { success: false, message: `Invalid status. Allowed values: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const canUpdateAll = ['admin', 'hr', 'manager', 'department_head'].includes(user.role)
    const employee = await Employee.findOne({ userId: user._id }).select('_id')

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
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message)
      return NextResponse.json(
        { success: false, message: messages.join('. ') },
        { status: 400 }
      )
    }
    if (error.name === 'CastError') {
      return NextResponse.json(
        { success: false, message: 'Invalid data format provided' },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { success: false, message: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}

// DELETE - Delete performance goal
export async function DELETE(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['PerformanceGoal'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { PerformanceGoal } = models

    if (!['admin', 'hr', 'manager', 'department_head'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

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
