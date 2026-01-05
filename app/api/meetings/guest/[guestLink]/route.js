import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Meeting from '@/models/Meeting'

/**
 * Public API route for guest meeting access
 * No authentication required - guests can join with just the link
 */

// GET - Validate guest link and get meeting info
export async function GET(request, { params }) {
  try {
    const { guestLink } = await params
    
    if (!guestLink) {
      return NextResponse.json(
        { success: false, message: 'Guest link is required' },
        { status: 400 }
      )
    }

    await connectDB()

    // Find meeting by guest link
    const meeting = await Meeting.findOne({
      'guestAccess.guestLink': guestLink,
      'guestAccess.enabled': true
    }).select('title description scheduledStart scheduledEnd roomId isLinkActive type status guestAccess.requireApproval')

    if (!meeting) {
      return NextResponse.json(
        { success: false, message: 'Invalid or expired guest link' },
        { status: 404 }
      )
    }

    // Check if meeting link is still active
    if (!meeting.isLinkActive) {
      return NextResponse.json(
        { success: false, message: 'This meeting has ended and the link is no longer active' },
        { status: 410 }
      )
    }

    // Check if meeting is online
    if (meeting.type !== 'online') {
      return NextResponse.json(
        { success: false, message: 'Guest access is only available for online meetings' },
        { status: 400 }
      )
    }

    // Check if meeting has ended
    const now = new Date()
    const endTime = new Date(meeting.scheduledEnd)
    if (now > endTime && meeting.status !== 'in-progress') {
      return NextResponse.json(
        { success: false, message: 'This meeting has ended' },
        { status: 410 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        title: meeting.title,
        description: meeting.description,
        scheduledStart: meeting.scheduledStart,
        scheduledEnd: meeting.scheduledEnd,
        roomId: meeting.roomId,
        requireApproval: meeting.guestAccess?.requireApproval || false
      }
    })

  } catch (error) {
    console.error('Error validating guest link:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to validate guest link' },
      { status: 500 }
    )
  }
}

// POST - Register guest joining the meeting
export async function POST(request, { params }) {
  try {
    const { guestLink } = await params
    const body = await request.json()
    const { guestName } = body

    if (!guestLink) {
      return NextResponse.json(
        { success: false, message: 'Guest link is required' },
        { status: 400 }
      )
    }

    if (!guestName || guestName.trim().length < 2) {
      return NextResponse.json(
        { success: false, message: 'Please enter your name (at least 2 characters)' },
        { status: 400 }
      )
    }

    await connectDB()

    // Find and update meeting
    const meeting = await Meeting.findOne({
      'guestAccess.guestLink': guestLink,
      'guestAccess.enabled': true
    })

    if (!meeting) {
      return NextResponse.json(
        { success: false, message: 'Invalid or expired guest link' },
        { status: 404 }
      )
    }

    // Validate meeting is active
    if (!meeting.isLinkActive) {
      return NextResponse.json(
        { success: false, message: 'This meeting has ended' },
        { status: 410 }
      )
    }

    if (meeting.type !== 'online') {
      return NextResponse.json(
        { success: false, message: 'Guest access is only available for online meetings' },
        { status: 400 }
      )
    }

    // Add guest to meeting
    const guestEntry = {
      name: guestName.trim(),
      joinedAt: new Date()
    }

    await Meeting.findByIdAndUpdate(meeting._id, {
      $push: { 'guestAccess.guests': guestEntry }
    })

    // Generate a temporary guest token for the session
    const guestToken = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    return NextResponse.json({
      success: true,
      data: {
        roomId: meeting.roomId,
        guestName: guestName.trim(),
        guestToken,
        meetingTitle: meeting.title
      }
    })

  } catch (error) {
    console.error('Error registering guest:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to join meeting' },
      { status: 500 }
    )
  }
}
