import { NextResponse } from 'next/server'
import { getTenantModel } from '@/lib/tenantModels'
import { connectSuperadminDB } from '@/lib/superadminDb'
import getTenantCompanyModel from '@/models/TenantCompany'

/**
 * Public API route for guest meeting access
 * No authentication required - guests can join with just the link
 * 
 * Guest link formats:
 * - New format: {tenantId}-{timestamp}-{random} (includes tenant info)
 * - Old format: guest-{timestamp}-{random} (requires tenant search)
 */

// Helper to extract tenant from guest link (new format)
function extractTenantFromLink(guestLink) {
  // Old format starts with "guest-" - no tenant info available
  if (guestLink.startsWith('guest-')) {
    return null
  }
  
  // New format: {tenantId}-{timestamp}-{random}
  const parts = guestLink.split('-')
  if (parts.length < 3) return null
  
  // Find the timestamp part (13 digit number)
  let tenantParts = []
  for (let i = 0; i < parts.length; i++) {
    if (/^\d{13}$/.test(parts[i])) {
      // This is the timestamp, everything before is tenant ID
      tenantParts = parts.slice(0, i)
      break
    }
  }
  
  if (tenantParts.length === 0) return null
  return `talio_${tenantParts.join('-')}`
}

// Helper to find meeting across all tenant databases (for old format links)
async function findMeetingAcrossTenants(guestLink) {
  try {
    // Connect to superadmin DB to get list of tenants
    await connectSuperadminDB()
    
    const TenantCompany = await getTenantCompanyModel()
    const tenants = await TenantCompany.find({ isActive: true }).select('databaseName').lean()
    
    // Search each tenant database for the meeting
    for (const tenant of tenants) {
      try {
        const Meeting = await getTenantModel(tenant.databaseName, 'Meeting')
        const meeting = await Meeting.findOne({
          'guestAccess.guestLink': guestLink,
          'guestAccess.enabled': true
        }).select('title description scheduledStart scheduledEnd roomId isLinkActive type status guestAccess.requireApproval')
        
        if (meeting) {
          return { meeting, tenantDatabase: tenant.databaseName }
        }
      } catch (err) {
        console.error(`Error searching tenant ${tenant.databaseName}:`, err.message)
        continue
      }
    }
    
    return null
  } catch (error) {
    console.error('Error finding meeting across tenants:', error.message)
    return null
  }
}

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

    let meeting = null
    let tenantDatabase = null

    // Try to extract tenant from link (new format)
    tenantDatabase = extractTenantFromLink(guestLink)
    
    if (tenantDatabase) {
      // New format - direct lookup in specific tenant
      try {
        const Meeting = await getTenantModel(tenantDatabase, 'Meeting')
        meeting = await Meeting.findOne({
          'guestAccess.guestLink': guestLink,
          'guestAccess.enabled': true
        }).select('title description scheduledStart scheduledEnd roomId isLinkActive type status guestAccess.requireApproval')
      } catch (err) {
        console.error('Error finding meeting in tenant:', err.message)
      }
    }
    
    // If not found or old format, search across all tenants
    if (!meeting) {
      const result = await findMeetingAcrossTenants(guestLink)
      if (result) {
        meeting = result.meeting
        tenantDatabase = result.tenantDatabase
      }
    }

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

    let meeting = null
    let tenantDatabase = null
    let Meeting = null

    // Try to extract tenant from link (new format)
    tenantDatabase = extractTenantFromLink(guestLink)
    
    if (tenantDatabase) {
      // New format - direct lookup in specific tenant
      try {
        Meeting = await getTenantModel(tenantDatabase, 'Meeting')
        meeting = await Meeting.findOne({
          'guestAccess.guestLink': guestLink,
          'guestAccess.enabled': true
        })
      } catch (err) {
        console.error('Error finding meeting in tenant:', err.message)
      }
    }
    
    // If not found or old format, search across all tenants
    if (!meeting) {
      const result = await findMeetingAcrossTenants(guestLink)
      if (result) {
        meeting = result.meeting
        tenantDatabase = result.tenantDatabase
        Meeting = await getTenantModel(tenantDatabase, 'Meeting')
      }
    }

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
