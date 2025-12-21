import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import OnboardingEmail from '@/models/OnboardingEmail'
import { verifyToken } from '@/lib/auth'

/**
 * GET - Fetch onboarding email history with filters
 */
export async function GET(request) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    
    const token = authHeader.split(' ')[1]
    const payload = await verifyToken(token)
    
    if (!payload) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }
    
    // Only admin and HR can access this
    if (!['admin', 'hr'].includes(payload.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }
    
    await connectDB()
    
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const status = searchParams.get('status') // 'sent', 'failed', 'pending', or null for all
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    
    // Build query
    const query = {}
    
    if (status && ['sent', 'failed', 'pending'].includes(status)) {
      query.status = status
    }
    
    if (search) {
      query.$or = [
        { recipientEmail: { $regex: search, $options: 'i' } },
        { recipientName: { $regex: search, $options: 'i' } },
        { employeeCode: { $regex: search, $options: 'i' } },
      ]
    }
    
    const skip = (page - 1) * limit
    const sortObj = { [sortBy]: sortOrder === 'asc' ? 1 : -1 }
    
    const [emails, total] = await Promise.all([
      OnboardingEmail.find(query)
        .populate('employee', 'firstName lastName employeeCode profilePicture')
        .populate('retriedBy', 'email')
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
      OnboardingEmail.countDocuments(query)
    ])
    
    // Get stats
    const [sentCount, failedCount, pendingCount] = await Promise.all([
      OnboardingEmail.countDocuments({ status: 'sent' }),
      OnboardingEmail.countDocuments({ status: 'failed' }),
      OnboardingEmail.countDocuments({ status: 'pending' }),
    ])
    
    return NextResponse.json({
      success: true,
      data: emails,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      stats: {
        sent: sentCount,
        failed: failedCount,
        pending: pendingCount,
        total: sentCount + failedCount + pendingCount,
      }
    })
  } catch (error) {
    console.error('Get onboarding emails error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch onboarding emails' },
      { status: 500 }
    )
  }
}
