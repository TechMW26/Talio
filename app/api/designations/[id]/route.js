import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import { LEVEL_NAMES, inferLevelFromTitle } from '@/lib/designationLevels'

const MANAGE_ROLES = new Set(['admin', 'super_admin', 'hr'])

function normalizeDesignationLevel(value, title) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 9) return parsed
  return inferLevelFromTitle(title)
}

async function getDesignationContext(request) {
  const auth = await getAuthAndModels(request, ['Designation'])
  if (!auth.success) return { error: NextResponse.json({ success: false, message: auth.message }, { status: 401 }) }
  return { auth, Designation: auth.models.Designation }
}

async function getId(params) {
  const resolved = await params
  return String(resolved?.id || '')
}
// GET - Get single designation
export async function GET(request, { params }) {
  try {
    const context = await getDesignationContext(request)
    if (context.error) return context.error
    const { Designation } = context
    const id = await getId(params)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid designation ID' }, { status: 400 })
    }

    const designation = await Designation.findById(id)

    if (!designation) {
      return NextResponse.json(
        { success: false, message: 'Designation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: designation,
    })
  } catch (error) {
    console.error('Get designation error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch designation' },
      { status: 500 }
    )
  }
}

// PUT - Update designation
export async function PUT(request, { params }) {
  try {
    const context = await getDesignationContext(request)
    if (context.error) return context.error
    const { auth, Designation } = context
    if (!MANAGE_ROLES.has(auth.user?.role)) {
      return NextResponse.json({ success: false, message: 'You do not have permission to update designations' }, { status: 403 })
    }
    const id = await getId(params)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid designation ID' }, { status: 400 })
    }
    const data = await request.json()

    // Prevent department updates (no longer used)
    if ('department' in data) delete data.department

    const current = await Designation.findById(id).select('title level').lean()
    if (!current) return NextResponse.json({ success: false, message: 'Designation not found' }, { status: 404 })
    const normalizedTitle = String(data.title ?? current.title ?? '').trim()
    if (!normalizedTitle) return NextResponse.json({ success: false, message: 'Designation title is required' }, { status: 400 })
    if ('level' in data || 'title' in data) data.level = normalizeDesignationLevel(data.level, normalizedTitle)
    if (data.level !== undefined && data.levelName === undefined) data.levelName = LEVEL_NAMES[data.level]

    const update = {}
    if (data.title !== undefined) update.title = data.title
    if (data.level !== undefined) update.level = data.level
    if (data.levelName !== undefined) update.levelName = data.levelName
    if (data.description !== undefined) update.description = data.description
    if (data.isActive !== undefined) update.isActive = data.isActive

    const designation = await Designation.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    )

    if (!designation) {
      return NextResponse.json(
        { success: false, message: 'Designation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Designation updated successfully',
      data: designation,
    })
  } catch (error) {
    console.error('Update designation error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update designation' },
      { status: 500 }
    )
  }
}

// DELETE - Delete designation
export async function DELETE(request, { params }) {
  try {
    const context = await getDesignationContext(request)
    if (context.error) return context.error
    const { auth, Designation } = context
    if (!MANAGE_ROLES.has(auth.user?.role)) {
      return NextResponse.json({ success: false, message: 'You do not have permission to delete designations' }, { status: 403 })
    }
    const id = await getId(params)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid designation ID' }, { status: 400 })
    }
    const designation = await Designation.findByIdAndDelete(id)

    if (!designation) {
      return NextResponse.json(
        { success: false, message: 'Designation not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Designation deleted successfully',
    })
  } catch (error) {
    console.error('Delete designation error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete designation' },
      { status: 500 }
    )
  }
}

