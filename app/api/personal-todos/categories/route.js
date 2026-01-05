import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Todo Categories API
 * GET - List all categories for user
 * POST - Create a new category
 */

// GET - List categories
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['TodoCategory'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth

    const categories = await models.TodoCategory.find({
      user: user.userId,
      isDeleted: false
    }).sort({ order: 1, createdAt: 1 })

    return NextResponse.json({
      success: true,
      data: categories
    })

  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}

// POST - Create category
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['TodoCategory'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const body = await request.json()

    const { name, color, icon, description } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { success: false, message: 'Category name is required' },
        { status: 400 }
      )
    }

    // Check for duplicate name
    const existing = await models.TodoCategory.findOne({
      user: user.userId,
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      isDeleted: false
    })

    if (existing) {
      return NextResponse.json(
        { success: false, message: 'A category with this name already exists' },
        { status: 400 }
      )
    }

    // Get max order for positioning
    const maxOrder = await models.TodoCategory.findOne({
      user: user.userId,
      isDeleted: false
    }).sort({ order: -1 }).select('order')

    const category = new models.TodoCategory({
      user: user.userId,
      name: name.trim(),
      color: color || '#6366f1',
      icon: icon || 'folder',
      description: description || '',
      order: (maxOrder?.order || 0) + 1
    })

    await category.save()

    return NextResponse.json({
      success: true,
      data: category,
      message: 'Category created successfully'
    }, { status: 201 })

  } catch (error) {
    console.error('Error creating category:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to create category' },
      { status: 500 }
    )
  }
}
