import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
export async function POST(request, context) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Helpdesk', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Helpdesk, Employee } = models

    // Await params (required in Next.js 15)
    const { id } = await context.params
    
    const { comment, commentedBy } = await request.json()

    if (!comment || !commentedBy) {
      return NextResponse.json(
        { success: false, message: 'Comment and commentedBy are required' },
        { status: 400 }
      )
    }

    const now = new Date()
    const ticket = await Helpdesk.findByIdAndUpdate(
      id,
      {
        $push: {
          comments: {
            // Schema-consistent fields
            content: comment,
            author: commentedBy,
            createdAt: now,
            // Backward-compat fields (used by some UIs/routes)
            comment,
            commentedBy,
            commentedAt: now
          }
        }
      },
      { new: true }
    )
    .populate('createdBy', 'firstName lastName userId')
    .populate('comments.author', 'firstName lastName')
    .populate({ path: 'comments.commentedBy', select: 'firstName lastName', strictPopulate: false })

    if (!ticket) {
      return NextResponse.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      )
    }

    // Notify the other party
    try {
      const io = global.io
      const { sendPushToUser } = require('@/lib/pushNotification')
      
      if (io) {
        // Determine who to notify
        // If commenter is the creator, notify assigned agent (if any) or admins
        // If commenter is not the creator, notify the creator
        
        const creatorId = ticket.createdBy._id.toString()
        const commenterId = commentedBy.toString()
        
        let targetUserId = null
        
        if (commenterId !== creatorId) {
          // Notify creator
          targetUserId = ticket.createdBy.userId
        } else if (ticket.assignedTo) {
          // Notify assigned agent
          const assignedAgent = await Employee.findById(ticket.assignedTo).select('userId')
          targetUserId = assignedAgent?.userId
        }

        if (targetUserId) {
          io.to(`user:${targetUserId}`).emit('helpdesk-comment', {
            ticketId: ticket._id,
            comment,
            commentedBy: ticket.comments[ticket.comments.length - 1].commentedBy,
            message: `New comment on ticket #${ticket.ticketNumber}`,
            timestamp: new Date()
          })

          // FCM Notification
          await sendPushToUser(
            targetUserId,
            {
              title: `💬 New Comment on Ticket #${ticket.ticketNumber}`,
              body: `${comment.substring(0, 50)}${comment.length > 50 ? '...' : ''}`,
            },
            {
              clickAction: `/dashboard/helpdesk/${ticket._id}`,
              eventType: 'helpdesk_comment',
              data: {
                ticketId: ticket._id.toString(),
                type: 'helpdesk_comment'
              }
            }
          )
        }
      }
    } catch (notifyError) {
      console.error('Notification error:', notifyError)
    }

    return NextResponse.json({
      success: true,
      message: 'Comment added successfully',
      data: ticket
    })

  } catch (error) {
    console.error('Add comment error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to add comment' },
      { status: 500 }
    )
  }
}
