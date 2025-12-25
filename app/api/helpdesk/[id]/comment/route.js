import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose'
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

// POST - Add comment to ticket
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Helpdesk', 'User']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { models } = auth;
    const { Helpdesk, User } = models;

    const { id } = await params;
    
    // Verify auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      );
    }

    const userId = decoded.payload.userId;
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
      .populate('comments.commentedBy', 'firstName lastName')

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
