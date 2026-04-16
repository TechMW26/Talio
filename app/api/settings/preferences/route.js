import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { uploadImage, deleteImage } from '@/lib/gridfs'

export const dynamic = 'force-dynamic'


// GET - Get system preferences
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['SystemPreferences'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { SystemPreferences } = models

    // Get system preferences (there should be only one document)
    let preferences = await SystemPreferences.findOne()

    if (!preferences) {
      // Create default preferences if none exist
      preferences = new SystemPreferences({
        currency: 'INR',
        currencySymbol: '₹',
        timeFormat: '12',
        timezone: 'Asia/Kolkata',
        workingDaysPerWeek: 5,
        workingHoursPerDay: 8,
        weekStartsOn: 'monday',
        defaultLeaveYear: new Date().getFullYear(),
        leaveCarryForward: true,
        maxCarryForwardDays: 10,
        lateThresholdMinutes: 15,
        halfDayThresholdHours: 4,
        autoMarkAbsent: true,
        emailNotifications: true,
        leaveApprovalNotifications: true,
        attendanceReminders: true,
        dateFormat: 'DD/MM/YYYY',
        companyName: 'Your Company',
        companyAddress: '',
        companyPhone: '',
        companyEmail: '',
      })
      await preferences.save()
    }

    return NextResponse.json({
      success: true,
      data: preferences
    })
  } catch (error) {
    console.error('Get preferences error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch preferences' },
      { status: 500 }
    )
  }
}

// PUT - Update system preferences (Admin only)
export async function PUT(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['SystemPreferences'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { SystemPreferences } = models

    // Only admin can update preferences
    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()

    // Find existing preferences or create new one
    let preferences = await SystemPreferences.findOne()

    // Handle companyLogo upload to GridFS if it's base64
    if (body.companyLogo && body.companyLogo.startsWith('data:image/')) {
      try {
        // Delete old logo from GridFS if exists
        if (preferences?.companyLogoFileId) {
          await deleteImage(preferences.companyLogoFileId).catch(() => { });
        }

        const base64Data = body.companyLogo.replace(/^data:image\/\w+;base64,/, '')
        const imageBuffer = Buffer.from(base64Data, 'base64')

        const gridfsResult = await uploadImage(imageBuffer, {
          category: 'settings',
          contentType: 'image/webp',
          originalName: `company_logo_${Date.now()}.webp`,
        })
        body.companyLogo = gridfsResult.url
        body.companyLogoFileId = String(gridfsResult._id)
        console.log(`[SystemPreferences] Company logo uploaded to GridFS`)
      } catch (imgError) {
        console.error('[SystemPreferences] GridFS logo upload failed:', imgError.message)
      }
    }

    if (preferences) {
      // Update existing preferences
      Object.keys(body).forEach(key => {
        if (body[key] !== undefined) {
          preferences[key] = body[key]
        }
      })
      await preferences.save()
    } else {
      // Create new preferences
      preferences = new SystemPreferences(body)
      await preferences.save()
    }

    return NextResponse.json({
      success: true,
      message: 'Preferences updated successfully',
      data: preferences
    })
  } catch (error) {
    console.error('Update preferences error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update preferences' },
      { status: 500 }
    )
  }
}
