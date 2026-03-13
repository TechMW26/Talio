import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitHolidayUpdate } from '@/lib/realtimeEvents'
import { buildCacheKey, buildCachePattern, getCache, setCache, clearCachePattern } from '@/lib/cache'

// GET - List holidays
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Holiday'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models, tenant } = auth
    const { Holiday } = models

    const { searchParams } = new URL(request.url)
    const year = searchParams.get('year')
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const upcoming = searchParams.get('upcoming')
    const limit = searchParams.get('limit')
    const type = searchParams.get('type')

    // Check Redis cache first (holidays change infrequently — 1 hour TTL)
    const cacheKey = buildCacheKey({
      tenantId: tenant?.databaseName,
      role: 'any',
      userId: 'all',
      namespace: 'holidays:list',
      params: { year, startDate: startDateParam, endDate: endDateParam, upcoming, limit, type },
    })
    const cached = await getCache(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const query = {}

    // Filter by holiday type (e.g. 'public', 'optional', 'restricted')
    if (type) {
      query.type = type
    }

    if (upcoming === 'true') {
      // Only return holidays from today onwards
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      query.date = { $gte: today }
    } else if (startDateParam && endDateParam) {
      // Support for date range queries (used by report page)
      const startDate = new Date(startDateParam)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(endDateParam)
      endDate.setHours(23, 59, 59, 999)
      query.date = { $gte: startDate, $lte: endDate }
    } else if (year) {
      const startDate = new Date(year, 0, 1)
      const endDate = new Date(year, 11, 31, 23, 59, 59)
      query.date = { $gte: startDate, $lte: endDate }
    }

    let holidayQuery = Holiday.find(query).sort({ date: 1 })

    if (limit) {
      holidayQuery = holidayQuery.limit(parseInt(limit))
    }

    const holidays = await holidayQuery

    const responseData = { success: true, data: holidays }
    // Cache for 1 hour
    await setCache(cacheKey, responseData, 3600)

    return NextResponse.json(responseData)
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
    const auth = await getAuthAndModels(request, ['Holiday'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models, tenant } = auth
    const { Holiday } = models

    const data = await request.json()

    const holiday = await Holiday.create(data)

    // Invalidate holiday caches so the new holiday appears immediately
    try {
      await clearCachePattern(buildCachePattern({ tenantId: tenant?.databaseName, namespace: 'holidays' }))
    } catch (cacheErr) {
      console.error('Failed to clear holiday cache:', cacheErr)
    }

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

