import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - List performance reviews
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Performance'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Performance } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const reviewPeriod = searchParams.get('reviewPeriod')

    const query = {}

    if (employeeId) {
      query.employee = employeeId
    }

    if (reviewPeriod) {
      query.reviewPeriod = reviewPeriod
    }

    const reviews = await Performance.find(query)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('reviewer', 'firstName lastName')
      .sort({ reviewDate: -1 })

    return NextResponse.json({
      success: true,
      data: reviews,
    })
  } catch (error) {
    console.error('Get performance error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch performance reviews' },
      { status: 500 }
    )
  }
}

// POST - Create performance review
export async function POST(request) {
  try {
    const data = await request.json()

    // Calculate overall rating
    const ratings = data.ratings || {}
    const ratingValues = Object.values(ratings).filter(val => typeof val === 'number')
    const overallRating = ratingValues.length > 0
      ? ratingValues.reduce((sum, val) => sum + val, 0) / ratingValues.length
      : 0

    const review = await Performance.create({
      ...data,
      overallRating: parseFloat(overallRating.toFixed(2)),
    })

    const populatedReview = await Performance.findById(review._id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('reviewer', 'firstName lastName')

    return NextResponse.json({
      success: true,
      message: 'Performance review created successfully',
      data: populatedReview,
    }, { status: 201 })
  } catch (error) {
    console.error('Create performance error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create performance review' },
      { status: 500 }
    )
  }
}

