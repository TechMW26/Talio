import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import SystemPreferences from '@/models/SystemPreferences'
import { verifyToken } from '@/lib/auth'
import { uploadImageToImageKit, deleteFromImageKit, getImageKitFolder } from '@/lib/imagekit'

export const dynamic = 'force-dynamic'

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}


// GET - Get system preferences
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

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
    const token = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Only admin can update preferences
    if (decoded.role !== 'admin') {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()

    // Find existing preferences or create new one
    let preferences = await SystemPreferences.findOne()

    // Handle companyLogo upload to ImageKit if it's base64
    if (body.companyLogo && body.companyLogo.startsWith('data:image/') && isImageKitConfigured()) {
      try {
        // Delete old logo from ImageKit if exists
        if (preferences?.companyLogoFileId) {
          await deleteFromImageKit(preferences.companyLogoFileId).catch(() => { });
        }

        // Get settings folder path
        const imagekitFolder = getImageKitFolder('settings');

        const imagekitResult = await uploadImageToImageKit(body.companyLogo, {
          fileName: `company_logo_${Date.now()}.webp`,
          folder: imagekitFolder,
          tags: ['company', 'logo', 'system'],
        });
        body.companyLogo = imagekitResult.url;
        body.companyLogoFileId = imagekitResult.fileId;
        console.log(`[SystemPreferences] Company logo uploaded to ImageKit: ${imagekitFolder}`);
      } catch (imgError) {
        console.error('[SystemPreferences] ImageKit logo upload failed:', imgError.message);
        // Keep original base64 as fallback
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
