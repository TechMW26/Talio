import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitHolidayUpdate } from '@/lib/realtimeEvents'

// GET - List holidays
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Holiday'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Holiday } = models

    const { searchParams } = new URL(request.url)
    const year = searchParams.get('year')

    const query = {}

    if (year) {
      const startDate = new Date(year, 0, 1)
      const endDate = new Date(year, 11, 31, 23, 59, 59)
      query.date = { $gte: startDate, $lte: endDate }
    }

    const holidays = await Holiday.find(query)
      .sort({ date: 1 })

    return NextResponse.json({
      success: true,
      data: holidays,
    })
  } catch (error) {
    console.error('Get holidays error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch holidays' },
      { status: 500 }
    )
  }
}

// POST - Create holiday
export async function POST(request) {
  try {
    const data = await request.json()

    const holiday = await Holiday.create(data)

    // Emit real-time holiday update to all users
    try {
      emitHolidayUpdate(
        {
          _id: holiday._id,
          name: holiday.name,
          date: holiday.date,
          type: holiday.type,
          isOptional: holiday.isOptional
        },
        { action: 'create', broadcast: true }
      )
    } catch (emitError) {
      console.error('Failed to emit holiday update:', emitError)
    }

    return NextResponse.json({
      success: true,
      message: 'Holiday created successfully',
      data: holiday,
    }, { status: 201 })
  } catch (error) {
    console.error('Create holiday error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create holiday' },
      { status: 500 }
    )
  }
}

