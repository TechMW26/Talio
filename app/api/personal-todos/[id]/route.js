import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Single Todo API
 * GET - Get a single todo
 * PATCH - Update a todo
 * DELETE - Soft delete a todo
 */

// GET - Get single todo
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params

    const todo = await models.PersonalTodo.findOne({
      _id: id,
      user: user.userId,
      isDeleted: false
    }).populate('category', 'name color icon')

    if (!todo) {
      return NextResponse.json(
        { success: false, message: 'Todo not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: todo
    })

  } catch (error) {
    console.error('Error fetching todo:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch todo' },
      { status: 500 }
    )
  }
}

// PATCH - Update todo
export async function PATCH(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params
    const body = await request.json()

    const todo = await models.PersonalTodo.findOne({
      _id: id,
      user: user.userId,
      isDeleted: false
    })

    if (!todo) {
      return NextResponse.json(
        { success: false, message: 'Todo not found' },
        { status: 404 }
      )
    }

    // Fields that can be updated
    const allowedUpdates = [
      'title', 'description', 'category', 'status', 'priority',
      'dueDate', 'dueTime', 'reminders', 'subtasks', 'notes',
      'tags', 'isRecurring', 'recurrence', 'order'
    ]

    // Track if due date was extended
    const oldDueDate = todo.dueDate
    
    // Apply updates
    allowedUpdates.forEach(field => {
      if (body[field] !== undefined) {
        if (field === 'dueDate') {
          todo[field] = body[field] ? new Date(body[field]) : undefined
        } else if (field === 'category') {
          todo[field] = body[field] || undefined
        } else {
          todo[field] = body[field]
        }
      }
    })

    // Track due date extensions for analytics
    if (oldDueDate && todo.dueDate && todo.dueDate > oldDueDate) {
      todo.analytics.dueDateExtensions = (todo.analytics.dueDateExtensions || 0) + 1
    }

    await todo.save()
    await todo.populate('category', 'name color icon')

    return NextResponse.json({
      success: true,
      data: todo,
      message: 'Todo updated successfully'
    })

  } catch (error) {
    console.error('Error updating todo:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update todo' },
      { status: 500 }
    )
  }
}

// DELETE - Soft delete todo
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params

    const todo = await models.PersonalTodo.findOneAndUpdate(
      { _id: id, user: user.userId, isDeleted: false },
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    )

    if (!todo) {
      return NextResponse.json(
        { success: false, message: 'Todo not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Todo deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting todo:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete todo' },
      { status: 500 }
    )
  }
}
