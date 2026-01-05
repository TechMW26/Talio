import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Subtasks API
 * POST - Add a subtask
 * PATCH - Update a subtask
 * DELETE - Remove a subtask
 */

// POST - Add subtask
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params
    const { title } = await request.json()

    if (!title?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Subtask title is required' },
        { status: 400 }
      )
    }

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

    // Add new subtask
    todo.subtasks.push({
      title: title.trim(),
      completed: false
    })

    await todo.save()
    await todo.populate('category', 'name color icon')

    return NextResponse.json({
      success: true,
      data: todo,
      message: 'Subtask added successfully'
    })

  } catch (error) {
    console.error('Error adding subtask:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to add subtask' },
      { status: 500 }
    )
  }
}

// PATCH - Update subtask
export async function PATCH(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params
    const { subtaskId, title, completed } = await request.json()

    if (!subtaskId) {
      return NextResponse.json(
        { success: false, message: 'Subtask ID is required' },
        { status: 400 }
      )
    }

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

    // Find and update subtask
    const subtask = todo.subtasks.id(subtaskId)
    if (!subtask) {
      return NextResponse.json(
        { success: false, message: 'Subtask not found' },
        { status: 404 }
      )
    }

    if (title !== undefined) subtask.title = title.trim()
    if (completed !== undefined) {
      subtask.completed = completed
      subtask.completedAt = completed ? new Date() : undefined
    }

    await todo.save()
    await todo.populate('category', 'name color icon')

    return NextResponse.json({
      success: true,
      data: todo,
      message: 'Subtask updated successfully'
    })

  } catch (error) {
    console.error('Error updating subtask:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update subtask' },
      { status: 500 }
    )
  }
}

// DELETE - Remove subtask
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const subtaskId = searchParams.get('subtaskId')

    if (!subtaskId) {
      return NextResponse.json(
        { success: false, message: 'Subtask ID is required' },
        { status: 400 }
      )
    }

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

    // Remove subtask
    todo.subtasks = todo.subtasks.filter(st => st._id.toString() !== subtaskId)
    
    await todo.save()
    await todo.populate('category', 'name color icon')

    return NextResponse.json({
      success: true,
      data: todo,
      message: 'Subtask removed successfully'
    })

  } catch (error) {
    console.error('Error removing subtask:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to remove subtask' },
      { status: 500 }
    )
  }
}
