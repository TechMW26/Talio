import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitHelpdeskUpdate } from '@/lib/realtimeEvents'

// GET - List helpdesk tickets
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    // Include Employee model for population
    const auth = await getAuthAndModels(request, ['Helpdesk', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    // Defensive check for models
    if (!auth.models) {
      console.error('[Helpdesk GET] No models returned from auth');
      return NextResponse.json({ success: false, message: 'Failed to load database models' }, { status: 500 });
    }

    const { Helpdesk, Employee } = auth.models

    if (!Helpdesk) {
      console.error('[Helpdesk GET] Helpdesk model not loaded');
      return NextResponse.json({ success: false, message: 'Failed to load Helpdesk model' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const limit = searchParams.get('limit')

    const query = {}

    if (employeeId) {
      query.createdBy = employeeId
    }

    if (status) {
      query.status = status
    }

    if (priority) {
      query.priority = priority
    }

    let ticketsQuery = Helpdesk.find(query)
      .populate('createdBy', 'firstName lastName employeeCode')
      .populate('assignedTo', 'firstName lastName')
      .sort({ createdAt: -1 })

    // Apply limit if provided
    if (limit) {
      const limitNum = parseInt(limit, 10)
      if (!isNaN(limitNum) && limitNum > 0) {
        ticketsQuery = ticketsQuery.limit(limitNum)
      }
    }

    const tickets = await ticketsQuery

    return NextResponse.json({
      success: true,
      data: tickets,
    })
  } catch (error) {
    console.error('Get helpdesk error:', error.message, error.stack)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch helpdesk tickets', error: error.message },
      { status: 500 }
    )
  }
}

// POST - Create helpdesk ticket
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    // Include Employee model for population
    const auth = await getAuthAndModels(request, ['Helpdesk', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Helpdesk } = models

    const data = await request.json()

    const ticket = await Helpdesk.create({
      ...data,
      ticketNumber: `TKT-${Date.now()}`,
      status: 'open',
    })

    const populatedTicket = await Helpdesk.findById(ticket._id)
      .populate('createdBy', 'firstName lastName employeeCode')

    // Emit real-time event
    emitHelpdeskUpdate(populatedTicket, [], { isNew: true, broadcast: true })

    return NextResponse.json({
      success: true,
      message: 'Ticket created successfully',
      data: populatedTicket,
    }, { status: 201 })
  } catch (error) {
    console.error('Create helpdesk error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create ticket' },
      { status: 500 }
    )
  }
}

