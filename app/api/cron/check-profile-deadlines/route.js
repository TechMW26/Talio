import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/check-profile-deadlines
 * Cron job to check and suspend users who haven't completed their profile
 * 
 * This should be called periodically (e.g., daily) by a cron service
 * or scheduled task. It checks all users with incomplete profiles
 * whose deadline has passed.
 * 
 * Security: In production, this endpoint should be protected with
 * a secret key or called only from trusted sources.
 */
export async function GET(request) {
  try {
    // Verify cron secret (optional but recommended for production)
    const cronSecret = request.headers.get('x-cron-secret')
    const expectedSecret = process.env.CRON_SECRET
    
    if (expectedSecret && cronSecret !== expectedSecret) {
      console.log('[Profile Deadline Check] Invalid cron secret')
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    await connectDB()

    const now = new Date()
    
    // Find users who:
    // 1. Are currently active
    // 2. Have a profile completion deadline that has passed
    // 3. Profile is not complete
    const usersToSuspend = await User.find({
      isActive: true,
      'profileCompletion.profileCompletionDeadline': { $lt: now },
      'profileCompletion.status': { $ne: 'complete' }
    }).select('_id email profileCompletion')

    console.log(`[Profile Deadline Check] Found ${usersToSuspend.length} users with expired deadlines`)

    if (usersToSuspend.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No users to suspend',
        data: { suspended: 0 }
      })
    }

    // Suspend each user
    const suspendedUsers = []
    const errors = []

    for (const user of usersToSuspend) {
      try {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              isActive: false,
              suspensionReason: 'profile_incomplete',
              suspendedAt: now
            }
          }
        )
        
        suspendedUsers.push({
          id: user._id.toString(),
          email: user.email,
          deadline: user.profileCompletion?.profileCompletionDeadline
        })

        console.log(`[Profile Deadline Check] Suspended user: ${user.email}`)

        // TODO: Send notification email to user about suspension
        // TODO: Notify HR/Admin about suspension
        
      } catch (error) {
        console.error(`[Profile Deadline Check] Error suspending user ${user.email}:`, error)
        errors.push({
          id: user._id.toString(),
          email: user.email,
          error: error.message
        })
      }
    }

    // Emit Socket.IO event if available (for real-time dashboard updates)
    if (global.io && suspendedUsers.length > 0) {
      global.io.emit('users:suspended', {
        count: suspendedUsers.length,
        reason: 'profile_incomplete',
        timestamp: now
      })
    }

    return NextResponse.json({
      success: true,
      message: `Suspended ${suspendedUsers.length} user(s) for incomplete profiles`,
      data: {
        suspended: suspendedUsers.length,
        users: suspendedUsers,
        errors: errors.length > 0 ? errors : undefined
      }
    })

  } catch (error) {
    console.error('[Profile Deadline Check] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to check profile deadlines'
    }, { status: 500 })
  }
}

/**
 * POST /api/cron/check-profile-deadlines
 * Manual trigger for profile deadline check (admin only)
 */
export async function POST(request) {
  try {
    // This endpoint requires admin authentication
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    // Verify token and check if user is admin
    const { jwtVerify } = await import('jose')
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    
    const { payload } = await jwtVerify(token, secret)
    
    if (!payload || !payload.userId) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()
    
    const user = await User.findById(payload.userId).select('role')
    if (!user || !['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Admin access required' }, { status: 403 })
    }

    // Call the GET handler logic
    return GET(request)

  } catch (error) {
    console.error('[Profile Deadline Check Manual] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to run profile deadline check'
    }, { status: 500 })
  }
}
