import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Complete/Uncomplete Todo
 * PATCH - Toggle todo completion status with analytics tracking
 */

export async function PATCH(request, { params }) {
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
    })

    if (!todo) {
      return NextResponse.json(
        { success: false, message: 'Todo not found' },
        { status: 404 }
      )
    }

    const now = new Date()

    if (todo.status === 'completed') {
      // Uncomplete the todo
      todo.status = 'pending'
      todo.completedAt = undefined
      // Reset analytics for uncompleted todo
      todo.analytics.completedOnTime = undefined
      todo.analytics.daysOverdue = undefined
      todo.analytics.completionTime = undefined
    } else {
      // Complete the todo
      todo.status = 'completed'
      todo.completedAt = now

      // Update analytics
      if (todo.dueDate) {
        const dueDate = new Date(todo.dueDate)
        // Set due date to end of day for comparison
        dueDate.setHours(23, 59, 59, 999)
        
        if (now <= dueDate) {
          todo.analytics.completedOnTime = true
          todo.analytics.daysOverdue = 0
        } else {
          todo.analytics.completedOnTime = false
          const diffTime = now - dueDate
          todo.analytics.daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        }
      } else {
        // No due date, consider it on time
        todo.analytics.completedOnTime = true
      }

      // Calculate completion time (time from creation to completion in hours)
      const creationTime = todo.createdAt
      const completionTimeHours = (now - creationTime) / (1000 * 60 * 60)
      todo.analytics.completionTime = Math.round(completionTimeHours * 100) / 100 // Round to 2 decimals
    }

    await todo.save()
    await todo.populate('category', 'name color icon')

    return NextResponse.json({
      success: true,
      data: todo,
      message: todo.status === 'completed' ? 'Todo completed!' : 'Todo marked as pending'
    })

  } catch (error) {
    console.error('Error toggling todo completion:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update todo' },
      { status: 500 }
    )
  }
}
