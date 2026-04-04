import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { respondToInvitation } from '@/lib/projectService'
import { dismissNotificationsForReference } from '@/lib/actionableNotifications'
import { emitEvent, EVENTS } from '@/lib/eventBus'

/**
 * POST /api/projects/[projectId]/members/respond
 * Respond to a project invitation (accept/reject)
 */
export async function POST(request, { params }) {
  try {
    const { projectId } = await params
    
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'Chat', 'ProjectTimelineEvent', 'User', 'Employee', 'ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    
    const { user, models } = auth
    const { User } = models
    
    const body = await request.json()
    const { action, reason } = body
    
    if (!action || !['accept', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, message: 'Invalid action. Must be "accept" or "reject"' },
        { status: 400 }
      )
    }
    
    // Get employee ID from user record
    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord?.employeeId) {
      return NextResponse.json(
        { success: false, message: 'Employee not found' },
        { status: 404 }
      )
    }
    
    const employeeId = userRecord.employeeId
    const accept = action === 'accept'
    
    try {
      // Call the service function to update membership
      const membership = await respondToInvitation(
        projectId, 
        employeeId, 
        accept, 
        reason || null, 
        models
      )
      
      // Dismiss any pending actionable notifications for this project invitation
      try {
        await dismissNotificationsForReference(models, 'Project', projectId)
      } catch (dismissErr) {
        console.error('[ProjectMembersRespond] Error dismissing notifications:', dismissErr)
        // Don't fail the request
      }

      try {
        await emitEvent(EVENTS.PROJECT_INVITATION_CHANGED, {
          projectId,
          action: accept ? 'accepted' : 'rejected',
        }, {
          userIds: [(user._id || user.userId).toString()],
          databaseName: auth.tenant?.databaseName,
        })
      } catch (eventBusErr) {
        console.error('[ProjectMembersRespond] Error emitting cache invalidation event:', eventBusErr)
      }
      
      // Emit socket event for real-time update
      if (global.io) {
        // Notify project members about the response
        global.io.emit(`project:${projectId}:member-response`, {
          employeeId: employeeId.toString(),
          action,
          projectId
        })
      }
      
      return NextResponse.json({
        success: true,
        message: accept ? 'Project invitation accepted' : 'Project invitation declined',
        data: membership
      })
    } catch (error) {
      console.error('[ProjectMembersRespond] Error:', error)
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('[POST /api/projects/[projectId]/members/respond] Error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to respond to invitation', error: error.message },
      { status: 500 }
    )
  }
}
