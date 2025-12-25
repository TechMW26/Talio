import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - Get single ticket
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Helpdesk'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Helpdesk } = models

    const ticket = await Helpdesk.findById(params.id)
      .populate('createdBy', 'firstName lastName employeeCode userId')
      .populate('assignedTo', 'firstName lastName')
      .populate('comments.commentedBy', 'firstName lastName')

    if (!ticket) {
      return NextResponse.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: ticket,
    })
  } catch (error) {
    console.error('Get ticket error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch ticket' },
      { status: 500 }
    )
  }
}

// PUT - Update ticket
export async function PUT(request, { params }) {
  try {
    const data = await request.json()

    const ticket = await Helpdesk.findByIdAndUpdate(
      params.id,
      data,
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'firstName lastName employeeCode userId')
      .populate('assignedTo', 'firstName lastName')

    if (!ticket) {
      return NextResponse.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      )
    }

    // Emit Socket.IO event for ticket updates
    try {
      const io = global.io
      const { sendPushToUser } = require('@/lib/pushNotification')

      if (io) {
        // Notify employee who created the ticket
        if (data.status || data.assignedTo) {
          // Use createdBy instead of employee
          const creatorUserId = ticket.createdBy?.userId

          if (creatorUserId) {
            let action = 'updated'
            let icon = '📝'
            if (data.status === 'resolved') {
              action = 'resolved'
              icon = '✅'
            } else if (data.status === 'closed') {
              action = 'closed'
              icon = '🔒'
            } else if (data.assignedTo) {
              action = 'assigned'
              icon = '🎫'
            }

            // Socket.IO event
            io.to(`user:${creatorUserId}`).emit('helpdesk-ticket', {
              ticket,
              action,
              message: `Ticket #${ticket.ticketNumber} has been ${action}`,
              timestamp: new Date()
            })
            console.log(`✅ [Socket.IO] Helpdesk ticket update sent to user:${creatorUserId}`)

            // FCM push notification
            try {
              await sendPushToUser(
                creatorUserId,
                {
                  title: `${icon} Ticket ${action.charAt(0).toUpperCase() + action.slice(1)}`,
                  body: `Ticket #${ticket.ticketNumber} has been ${action}`,
                },
                {
                  clickAction: '/dashboard/helpdesk',
                  eventType: 'helpdesk_ticket',
                  data: {
                    ticketId: ticket._id.toString(),
                    action,
                    type: 'helpdesk_ticket'
                  }
                }
              )
              console.log(`📲 [FCM] Helpdesk notification sent to user:${creatorUserId}`)
            } catch (fcmError) {
              console.error('Failed to send helpdesk FCM notification:', fcmError)
            }
          }
        }

        // Notify assigned agent
        if (data.assignedTo) {
          const Employee = require('@/models/Employee').default
          const assignedDoc = await Employee.findById(data.assignedTo).select('userId')
          const assignedUserId = assignedDoc?.userId

          if (assignedUserId) {
            // Socket.IO event
            io.to(`user:${assignedUserId}`).emit('helpdesk-ticket', {
              ticket,
              action: 'assigned',
              message: `You have been assigned ticket #${ticket.ticketNumber}`,
              timestamp: new Date()
            })
            console.log(`✅ [Socket.IO] Helpdesk ticket assignment sent to user:${assignedUserId}`)

            // FCM push notification
            try {
              await sendPushToUser(
                assignedUserId,
                {
                  title: '🎫 Ticket Assigned',
                  body: `You have been assigned ticket #${ticket.ticketNumber}`,
                },
                {
                  clickAction: '/dashboard/helpdesk',
                  eventType: 'helpdesk_ticket',
                  data: {
                    ticketId: ticket._id.toString(),
                    action: 'assigned',
                    type: 'helpdesk_ticket'
                  }
                }
              )
              console.log(`📲 [FCM] Helpdesk assignment notification sent to user:${assignedUserId}`)
            } catch (fcmError) {
              console.error('Failed to send helpdesk assignment FCM notification:', fcmError)
            }
          }
        }
      }
    } catch (socketError) {
      console.error('Failed to send helpdesk socket notification:', socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Ticket updated successfully',
      data: ticket,
    })
  } catch (error) {
    console.error('Update ticket error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update ticket' },
      { status: 500 }
    )
  }
}

// DELETE - Delete ticket
export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    const ticket = await Helpdesk.findByIdAndDelete(id)

    if (!ticket) {
      return NextResponse.json(
        { success: false, message: 'Ticket not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Ticket deleted successfully',
    })
  } catch (error) {
    console.error('Delete ticket error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to delete ticket' },
      { status: 500 }
    )
  }
}

// PATCH - Partial update ticket
export async function PATCH(request, { params }) {
  try {
    const { id } = await params
    const data = await request.json()

    const ticket = await Helpdesk.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true, runValidators: true }
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

    // Emit Socket.IO event for ticket updates
    try {
      const io = global.io
      if (io) {
        const creatorUserId = ticket.createdBy?.userId
        if (creatorUserId && (data.status || data.assignedTo)) {
          let action = 'updated'
          if (data.status === 'resolved') action = 'resolved'
          else if (data.status === 'closed') action = 'closed'
          else if (data.status === 'in-progress') action = 'in progress'

          io.to(`user:${creatorUserId}`).emit('helpdesk-ticket', {
            ticket,
            action,
            message: `Ticket #${ticket.ticketNumber} has been ${action}`,
            timestamp: new Date()
          })
        }
      }
    } catch (socketError) {
      console.error('Failed to send helpdesk socket notification:', socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Ticket updated successfully',
      data: ticket,
    })
  } catch (error) {
    console.error('Patch ticket error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update ticket' },
      { status: 500 }
    )
  }
}

