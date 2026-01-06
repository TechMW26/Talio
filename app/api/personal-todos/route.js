import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Personal Todos API
 * GET - List todos with filters
 * POST - Create a new todo
 */

// GET - List todos
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo', 'TodoCategory'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { searchParams } = new URL(request.url)
    
    // Query parameters
    const status = searchParams.get('status') // pending, completed, all
    const categoryId = searchParams.get('category')
    const priority = searchParams.get('priority')
    const dueDate = searchParams.get('dueDate') // today, week, overdue, upcoming
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 50
    const sortBy = searchParams.get('sortBy') || 'order' // order, dueDate, createdAt, priority
    const sortOrder = searchParams.get('sortOrder') || 'asc'

    // Build query
    const query = {
      user: user.userId,
      isDeleted: false
    }

    // Status filter
    if (status && status !== 'all') {
      // Handle comma-separated status values
      if (status.includes(',')) {
        query.status = { $in: status.split(',').map(s => s.trim()) }
      } else {
        query.status = status
      }
    }

    // Category filter
    if (categoryId) {
      if (categoryId === 'uncategorized') {
        query.category = { $exists: false }
      } else {
        query.category = categoryId
      }
    }

    // Priority filter
    if (priority) {
      query.priority = priority
    }

    // Due date filter
    if (dueDate) {
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const weekEnd = new Date(today)
      weekEnd.setDate(weekEnd.getDate() + 7)

      switch (dueDate) {
        case 'today':
          query.dueDate = { $gte: today, $lt: tomorrow }
          break
        case 'week':
          query.dueDate = { $gte: today, $lt: weekEnd }
          break
        case 'overdue':
          query.dueDate = { $lt: today }
          query.status = 'pending'
          break
        case 'upcoming':
          query.dueDate = { $gte: tomorrow }
          break
        case 'no-date':
          query.dueDate = { $exists: false }
          break
      }
    }

    // Search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ]
    }

    // Sort options
    const sortOptions = {}
    if (sortBy === 'priority') {
      // Custom sort for priority
      sortOptions.priority = sortOrder === 'desc' ? -1 : 1
    } else if (sortBy === 'dueDate') {
      sortOptions.dueDate = sortOrder === 'desc' ? -1 : 1
    } else if (sortBy === 'createdAt') {
      sortOptions.createdAt = sortOrder === 'desc' ? -1 : 1
    } else {
      sortOptions.order = 1
      sortOptions.createdAt = -1
    }

    // Execute query
    const skip = (page - 1) * limit
    
    const [todos, total] = await Promise.all([
      models.PersonalTodo.find(query)
        .populate('category', 'name color icon')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      models.PersonalTodo.countDocuments(query)
    ])

    // Get counts by status
    const [pendingCount, completedCount, overdueCount] = await Promise.all([
      models.PersonalTodo.countDocuments({ user: user.userId, isDeleted: false, status: 'pending' }),
      models.PersonalTodo.countDocuments({ user: user.userId, isDeleted: false, status: 'completed' }),
      models.PersonalTodo.countDocuments({ 
        user: user.userId, 
        isDeleted: false, 
        status: 'pending',
        dueDate: { $lt: new Date() }
      })
    ])

    return NextResponse.json({
      success: true,
      data: todos,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      counts: {
        pending: pendingCount,
        completed: completedCount,
        overdue: overdueCount,
        total: pendingCount + completedCount
      }
    })

  } catch (error) {
    console.error('Error fetching todos:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch todos' },
      { status: 500 }
    )
  }
}

// POST - Create todo
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo', 'TodoCategory', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const body = await request.json()

    const {
      title,
      category,
      priority,
      dueDate,
      dueTime,
      reminders,
      tags,
      isRecurring,
      recurrence
    } = body

    if (!title || !title.trim()) {
      return NextResponse.json(
        { success: false, message: 'Title is required' },
        { status: 400 }
      )
    }

    // Extract employee ID properly (could be object or string)
    const employeeId = user.employeeId?._id || user.employeeId
    if (!employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }

    // Get max order for ordering new todos at the end
    const maxOrderTodo = await models.PersonalTodo.findOne({
      user: user.userId,
      category: category || { $exists: false },
      isDeleted: false
    }).sort({ order: -1 }).select('order')

    const newOrder = (maxOrderTodo?.order || 0) + 1

    // Validate and clean priority - only accept valid enum values
    const validPriorities = ['low', 'medium', 'high', 'urgent']
    const cleanPriority = priority && validPriorities.includes(priority) ? priority : 'medium'

    // Create todo data object
    const todoData = {
      user: user.userId,
      employee: employeeId,
      title: title.trim(),
      priority: cleanPriority,
      order: newOrder,
      subtasks: [],
      tags: Array.isArray(tags) ? tags : [],
      isRecurring: isRecurring || false
    }

    // Only add optional fields if they have valid values
    if (category) todoData.category = category
    if (dueDate) todoData.dueDate = new Date(dueDate)
    if (dueTime) todoData.dueTime = dueTime
    if (isRecurring && recurrence) todoData.recurrence = recurrence

    // Process reminders - convert to schema format
    if (Array.isArray(reminders) && reminders.length > 0) {
      todoData.reminders = reminders.map(r => {
        // Handle both old format {time, type, sent} and new format
        if (r.type && ['15min', '30min', '1hour', '1day', 'custom'].includes(r.type)) {
          return r
        }
        // If it's a simple string type, convert it
        return { type: r.type || '1hour', sent: false }
      }).filter(r => r.type) // Filter out invalid reminders
    }

    const todo = new models.PersonalTodo(todoData)

    await todo.save()

    // Populate category for response
    await todo.populate('category', 'name color icon')

    return NextResponse.json({
      success: true,
      data: todo,
      message: 'Todo created successfully'
    }, { status: 201 })

  } catch (error) {
    console.error('Error creating todo:', error.message, error.stack)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create todo' },
      { status: 500 }
    )
  }
}
