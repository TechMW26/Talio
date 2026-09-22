import { NextResponse, after } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { requirePermission } from '@/lib/permissions'
import { sendPushToUser } from '@/lib/pushNotification'
import { emitEvent, EVENTS } from '@/lib/eventBus'
import { emitRealtimeEvent } from '@/lib/realtimeEvents'
import { sanitizeTicketUpdate } from '@/lib/helpdeskInput'

// GET - Get single ticket
export async function GET(request, context) {
  try {
    // Await params (required in Next.js 15)
    const { id } = await context.params

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Helpdesk'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Helpdesk } = models

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid ticket id' },
        { status: 400 }
      )
    }

    const ticket = await Helpdesk.findById(id)
      .populate('createdBy', 'firstName lastName employeeCode userId')
      .populate('assignedTo', 'firstName lastName')
      // Helpdesk schema defines comments as { content, author, createdAt }
      .populate('comments.author', 'firstName lastName')
      // Backward-compat: some data/routes may still use commentedBy
      .populate({ path: 'comments.commentedBy', select: 'firstName lastName', strictPopulate: false })

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


export async function PUT(request, context) {
  try {
    const auth = await requirePermission('helpdesk_manage', 'edit')(request, ['Helpdesk', 'Employee', 'Notification'])
    if (auth.denied) return auth.denied
    const { id } = await context.params
    if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, message: 'Invalid ticket id' }, { status: 400 })
    let data
    try {
      data = sanitizeTicketUpdate(await request.json())
    } catch (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 })
    }
    if (Object.hasOwn(data, 'assignedTo')) {
      const assignment = await requirePermission('helpdesk_manage', 'assign')(request)
      if (assignment.denied) return assignment.denied
      if (data.assignedTo && !(await auth.models.Employee.exists({ _id: data.assignedTo }))) {
        return NextResponse.json({ success: false, message: 'Assigned employee not found' }, { status: 404 })
      }
    }
    const ticket = await auth.models.Helpdesk.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
      .populate('createdBy', 'firstName lastName employeeCode userId')
      .populate('assignedTo', 'firstName lastName userId')
    if (!ticket) return NextResponse.json({ success: false, message: 'Ticket not found' }, { status: 404 })
    after(async () => {
      try {
        const userIds = [...new Set([ticket.createdBy?.userId, ticket.assignedTo?.userId].filter(Boolean).map(String))]
        const action = data.status || (data.assignedTo ? 'assigned' : 'updated')
        const payload = { ticketId: String(ticket._id), ticketNumber: ticket.ticketNumber, status: ticket.status, action }
        emitRealtimeEvent('helpdesk-ticket', payload, { userIds })
        await emitEvent(EVENTS.HELPDESK_TICKET_CHANGED, payload, { userIds, databaseName: auth.tenant.databaseName })
        await Promise.allSettled(userIds.map(userId => sendPushToUser(userId, {
          title: 'Helpdesk ticket updated',
          body: `Ticket #${ticket.ticketNumber} is ${action}`,
        }, {
          clickAction: `/dashboard/helpdesk/${ticket._id}`,
          eventType: 'helpdesk_ticket', data: payload,
          models: { User: auth.models.User, Notification: auth.models.Notification },
        })))
      } catch (error) {
        console.error('[Helpdesk] Update notification failed:', error)
      }
    })
    return NextResponse.json({ success: true, message: 'Ticket updated successfully', data: ticket })
  } catch (error) {
    console.error('Update ticket error:', error)
    return NextResponse.json({ success: false, message: 'Failed to update ticket' }, { status: 500 })
  }
}

// Both callers use identical validation, authorization and notifications.
export const PATCH = PUT

export async function DELETE(request, context) {
  try {
  const auth = await requirePermission('helpdesk_manage', 'delete')(request, ['Helpdesk'])
  if (auth.denied) return auth.denied
  const { id } = await context.params
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, message: 'Invalid ticket id' }, { status: 400 })
  const ticket = await auth.models.Helpdesk.findByIdAndDelete(id)
  return ticket
    ? NextResponse.json({ success: true, message: 'Ticket deleted successfully' })
    : NextResponse.json({ success: false, message: 'Ticket not found' }, { status: 404 })
  } catch (error) {
    console.error('Delete ticket error:', error)
    return NextResponse.json({ success: false, message: 'Failed to delete ticket' }, { status: 500 })
  }
}

