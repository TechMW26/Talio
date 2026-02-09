import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// POST - Add comment to ticket
export async function POST(request, context) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Helpdesk', 'User']);
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { Helpdesk, User } = models;

    // Await params (required in Next.js 15)
    const { id } = await context.params;
    
    const userId = user._id || user.userId;
    const userRecord = await User.findById(userId).populate('employeeId');
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    const data = await request.json();
    const { comment, isInternal = false } = data;

    if (!comment || !comment.trim()) {
      return NextResponse.json(
        { success: false, message: 'Comment is required' },
        { status: 400 }
      );
    }

    const ticket = await Helpdesk.findByIdAndUpdate(
      id,
      {
        $push: {
          comments: {
            // Schema-consistent fields
            content: comment.trim(),
            author: userRecord.employeeId._id,
            createdAt: new Date(),
            // Backward-compat fields
            comment: comment.trim(),
            commentedBy: userRecord.employeeId._id,
            commentedAt: new Date(),
            isInternal
          }
        }
      },
      { new: true }
    )
      .populate('createdBy', 'firstName lastName employeeCode userId')
      .populate('assignedTo', 'firstName lastName')
      .populate('comments.author', 'firstName lastName')
      .populate({ path: 'comments.commentedBy', select: 'firstName lastName', strictPopulate: false })

    if (!ticket) {
      return NextResponse.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      )
    }

    // Send notification to ticket creator if comment is from someone else
    try {
      const io = global.io
      if (io && ticket.createdBy?.userId && ticket.createdBy._id.toString() !== user.employeeId._id.toString()) {
        io.to(`user:${ticket.createdBy.userId}`).emit('helpdesk-ticket', {
          ticket,
          action: 'commented',
          message: `New comment on ticket #${ticket.ticketNumber}`,
          timestamp: new Date()
        })
      }
    } catch (socketError) {
      console.error('Failed to send comment socket notification:', socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Comment added successfully',
      data: ticket,
    })
  } catch (error) {
    console.error('Add comment error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to add comment' },
      { status: 500 }
    )
  }
}
