import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/expire-past
 * 
 * Automatically handles expired meetings:
 * - Moves meetings past their end time to 'completed' status (if not already)
 * - Deactivates meeting links for online meetings
 * 
 * This can be called by a cron job or triggered periodically
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Meeting'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Meeting } = models

    const now = new Date()

    // Find all meetings that:
    // 1. Have ended (scheduledEnd < now)
    // 2. Are still in 'scheduled' or 'in-progress' status
    // 3. Have active links (for online meetings)
    const expiredMeetings = await Meeting.find({
      scheduledEnd: { $lt: now },
      status: { $in: ['scheduled', 'in-progress'] }
    })

    let updatedCount = 0
    let deactivatedLinksCount = 0

    for (const meeting of expiredMeetings) {
      const updates = {
        status: 'completed'
      }

      // Deactivate meeting link for online meetings
      if (meeting.type === 'online' && meeting.isLinkActive) {
        updates.isLinkActive = false
        deactivatedLinksCount++
      }

      // Set actualEnd if not already set
      if (!meeting.actualEnd) {
        updates.actualEnd = meeting.scheduledEnd
      }

      await Meeting.findByIdAndUpdate(meeting._id, updates)
      updatedCount++
    }

    // Also deactivate links for any online meetings that are completed but still have active links
    const completedWithActiveLinks = await Meeting.updateMany(
      {
        type: 'online',
        status: 'completed',
        isLinkActive: true,
        scheduledEnd: { $lt: now }
      },
      {
        $set: { isLinkActive: false }
      }
    )

    deactivatedLinksCount += completedWithActiveLinks.modifiedCount

    console.log(`[Meeting Expiry] Updated ${updatedCount} meetings to completed, deactivated ${deactivatedLinksCount} meeting links`)

    return NextResponse.json({
      success: true,
      message: `Processed ${updatedCount} expired meetings`,
      data: {
        meetingsCompleted: updatedCount,
        linksDeactivated: deactivatedLinksCount
      }
    })

  } catch (error) {
    console.error('[Meeting Expiry] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process expired meetings' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/meetings/expire-past
 * 
 * Check status of expired meetings without modifying them
 */
export async function GET(request) {
  try {
    const now = new Date()

    const expiredCount = await Meeting.countDocuments({
      scheduledEnd: { $lt: now },
      status: { $in: ['scheduled', 'in-progress'] }
    })

    const activeLinksOnExpiredCount = await Meeting.countDocuments({
      type: 'online',
      isLinkActive: true,
      scheduledEnd: { $lt: now }
    })

    return NextResponse.json({
      success: true,
      data: {
        expiredMeetingsPending: expiredCount,
        expiredMeetingsWithActiveLinks: activeLinksOnExpiredCount
      }
    })

  } catch (error) {
    console.error('[Meeting Expiry Check] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to check expired meetings' },
      { status: 500 }
    )
  }
}
