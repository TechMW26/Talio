import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { LEVEL_NAMES, inferLevelFromTitle } from '@/lib/designationLevels'

const MANAGE_ROLES = new Set(['admin', 'super_admin', 'hr'])
// GET - List all designations
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Designation'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Designation } = models

    if (!MANAGE_ROLES.has(user?.role)) {
      return NextResponse.json({ success: false, message: 'You do not have permission to create designations' }, { status: 403 })
    }

    const designations = await Designation.find({ isActive: true }).sort({ title: 1 })

    return NextResponse.json({
      success: true,
      data: designations,
    })
  } catch (error) {
    console.error('Get designations error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch designations' },
      { status: 500 }
    )
  }
}

// POST - Create new designation
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Designation'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Designation } = models

    const data = await request.json()

    // Remove department if present (no longer used)
    if ('department' in data) delete data.department

    data.title = String(data.title || '').trim()
    if (!data.title) return NextResponse.json({ success: false, message: 'Designation title is required' }, { status: 400 })
    const parsedLevel = Number.parseInt(data.level, 10)
    data.level = Number.isInteger(parsedLevel) && parsedLevel >= 1 && parsedLevel <= 9
      ? parsedLevel
      : inferLevelFromTitle(data.title)
    data.levelName = data.levelName || LEVEL_NAMES[data.level]

    // Auto-generate code from title if missing
    if (!data.code) {
      const base = (data.title || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'DESIG'
      let candidate = base
      let suffix = 2
      while (await Designation.exists({ code: candidate })) candidate = `${base}-${suffix++}`
      data.code = candidate
    }

    const designation = await Designation.create(data)

    return NextResponse.json({
      success: true,
      message: 'Designation created successfully',
      data: designation,
    }, { status: 201 })
  } catch (error) {
    console.error('Create designation error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create designation' },
      { status: 500 }
    )
  }
}

