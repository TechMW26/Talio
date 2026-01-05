import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Single Category API
 * GET - Get a single category with todo count
 * PATCH - Update a category
 * DELETE - Soft delete a category
 */

// GET - Get single category
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['TodoCategory', 'PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params

    const category = await models.TodoCategory.findOne({
      _id: id,
      user: user.userId,
      isDeleted: false
    })

    if (!category) {
      return NextResponse.json(
        { success: false, message: 'Category not found' },
        { status: 404 }
      )
    }

    // Get todo count for this category
    const todoCount = await models.PersonalTodo.countDocuments({
      user: user.userId,
      category: id,
      isDeleted: false
    })

    return NextResponse.json({
      success: true,
      data: {
        ...category.toObject(),
        todoCount
      }
    })

  } catch (error) {
    console.error('Error fetching category:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch category' },
      { status: 500 }
    )
  }
}

// PATCH - Update category
export async function PATCH(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['TodoCategory'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params
    const body = await request.json()

    const category = await models.TodoCategory.findOne({
      _id: id,
      user: user.userId,
      isDeleted: false
    })

    if (!category) {
      return NextResponse.json(
        { success: false, message: 'Category not found' },
        { status: 404 }
      )
    }

    // Check for duplicate name if name is being changed
    if (body.name && body.name.trim().toLowerCase() !== category.name.toLowerCase()) {
      const existing = await models.TodoCategory.findOne({
        user: user.userId,
        _id: { $ne: id },
        name: { $regex: new RegExp(`^${body.name.trim()}$`, 'i') },
        isDeleted: false
      })

      if (existing) {
        return NextResponse.json(
          { success: false, message: 'A category with this name already exists' },
          { status: 400 }
        )
      }
    }

    // Fields that can be updated
    const allowedUpdates = ['name', 'color', 'icon', 'description', 'order']
    
    allowedUpdates.forEach(field => {
      if (body[field] !== undefined) {
        category[field] = body[field]
      }
    })

    await category.save()

    return NextResponse.json({
      success: true,
      data: category,
      message: 'Category updated successfully'
    })

  } catch (error) {
    console.error('Error updating category:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update category' },
      { status: 500 }
    )
  }
}

// DELETE - Soft delete category
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['TodoCategory', 'PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { id } = await params

    const category = await models.TodoCategory.findOne({
      _id: id,
      user: user.userId,
      isDeleted: false
    })

    if (!category) {
      return NextResponse.json(
        { success: false, message: 'Category not found' },
        { status: 404 }
      )
    }

    // Check if it's the default category
    if (category.isDefault) {
      return NextResponse.json(
        { success: false, message: 'Cannot delete the default category' },
        { status: 400 }
      )
    }

    // Soft delete the category
    category.isDeleted = true
    category.deletedAt = new Date()
    await category.save()

    // Remove category reference from all todos (set to null)
    await models.PersonalTodo.updateMany(
      { user: user.userId, category: id },
      { $unset: { category: '' } }
    )

    return NextResponse.json({
      success: true,
      message: 'Category deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting category:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete category' },
      { status: 500 }
    )
  }
}
