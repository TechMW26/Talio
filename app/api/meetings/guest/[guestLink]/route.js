import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { SignJWT } from 'jose'
import { getTenantModel } from '@/lib/tenantModels'
import { connectSuperadminDB } from '@/lib/superadminDb'
import getTenantCompanyModel from '@/models/TenantCompany'

const MAX_GUEST_NAME_LENGTH = 80
const GUEST_SESSION_TTL_SECONDS = 4 * 60 * 60

function getGuestSessionExpiry(meeting) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const meetingEndSeconds = Math.floor(new Date(meeting.scheduledEnd).getTime() / 1000)
  const maximumExpiry = nowSeconds + GUEST_SESSION_TTL_SECONDS

  if (!Number.isFinite(meetingEndSeconds)) {
    return maximumExpiry
  }

  return Math.max(nowSeconds + 5 * 60, Math.min(maximumExpiry, meetingEndSeconds + 30 * 60))
}

async function createGuestSessionToken({ meeting, tenantDatabase, guestName }) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required to create a guest meeting session')
  }

  const guestId = `guest_${randomUUID()}`
  const token = await new SignJWT({
    type: 'meeting_guest',
    roomId: meeting.roomId,
    guestId,
    guestName,
    tenantDatabaseName: tenantDatabase,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(getGuestSessionExpiry(meeting))
    .sign(new TextEncoder().encode(process.env.JWT_SECRET))

  return { guestId, token }
}

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
  if (guestLink.startsWith('v2.')) {
    const [, encodedTenant] = guestLink.split('.')
    if (!encodedTenant) return null

    try {
      const databaseName = Buffer.from(encodedTenant, 'base64url').toString('utf8')
      return /^[a-zA-Z0-9_-]+$/.test(databaseName) ? databaseName : null
    } catch {
      return null
    }
  }

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

    const normalizedGuestName = typeof guestName === 'string' ? guestName.trim() : ''
    if (
      normalizedGuestName.length < 2 ||
      normalizedGuestName.length > MAX_GUEST_NAME_LENGTH
    ) {
      return NextResponse.json(
        {
          success: false,
          message: `Please enter a name between 2 and ${MAX_GUEST_NAME_LENGTH} characters`
        },
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
      name: normalizedGuestName,
      joinedAt: new Date()
    }

    const [{ guestId, token: guestToken }] = await Promise.all([
      createGuestSessionToken({
        meeting,
        tenantDatabase,
        guestName: normalizedGuestName
      }),
      Meeting.findByIdAndUpdate(meeting._id, {
        $push: { 'guestAccess.guests': guestEntry }
      })
    ])

    return NextResponse.json({
      success: true,
      data: {
        roomId: meeting.roomId,
        guestName: normalizedGuestName,
        guestId,
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
