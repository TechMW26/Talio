import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'


// GET - Fetch company settings
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { CompanySettings } = models

    // Get company settings (there should only be one document)
    let settings = await CompanySettings.findOne()

    // If no settings exist, create default settings
    if (!settings) {
      settings = await CompanySettings.create({
        companyName: 'My Company',
        checkInTime: '09:00',
        checkOutTime: '18:00',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        geofence: {
          enabled: false,
          radius: 100,
          strictMode: false,
          notifyOnExit: true,
          requireApproval: true,
        },
      })
    }

    console.log('GET company settings - notifications:', settings.notifications)

    return NextResponse.json({
      success: true,
      data: settings
    })

  } catch (error) {
    console.error('Get company settings error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch company settings' },
      { status: 500 }
    )
  }
}

// PUT - Update company settings (Admin/HR only)
export async function PUT(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['CompanySettings'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { CompanySettings } = models

    // Check if user is admin or hr
    if (user.role !== 'admin' && user.role !== 'hr') {
      return NextResponse.json(
        { success: false, message: 'Only admin and HR can update company settings' },
        { status: 403 }
      )
    }

    const body = await request.json()

    // Get existing settings or create new
    let settings = await CompanySettings.findOne()

    if (settings) {
      // Update existing settings
      Object.keys(body).forEach(key => {
        if (key === 'geofence' && body.geofence) {
          // Merge geofence settings, filtering out undefined and null values
          const newGeofence = Object.fromEntries(
            Object.entries(body.geofence).filter(([_, v]) => v !== undefined && v !== null)
          )

          // Update each field individually to avoid undefined values
          Object.keys(newGeofence).forEach(geoKey => {
            settings.geofence[geoKey] = newGeofence[geoKey]
          })

          // Don't set center or radius if they're not provided (we're using multiple locations now)
          // This prevents validation errors for legacy fields
        } else if (key === 'attendance' && body.attendance) {
          settings.attendance = {
            ...settings.attendance,
            ...body.attendance,
          }
        } else if (key === 'leave' && body.leave) {
          settings.leave = {
            ...settings.leave,
            ...body.leave,
          }
        } else if (key === 'notifications' && body.notifications) {
          // Deep merge notifications to preserve nested emailEvents
          console.log('Updating notifications:', {
            current: settings.notifications,
            incoming: body.notifications
          })

          settings.notifications = {
            ...settings.notifications,
            ...body.notifications,
            emailEvents: {
              ...(settings.notifications?.emailEvents || {}),
              ...(body.notifications?.emailEvents || {}),
            },
          }

          console.log('Updated notifications:', settings.notifications)
        } else if (key === 'companyAddress' && body.companyAddress) {
          settings.companyAddress = {
            ...settings.companyAddress,
            ...body.companyAddress,
          }
        } else if (key === 'payroll' && body.payroll) {
          // Deep merge payroll settings
          settings.payroll = {
            ...settings.payroll?.toObject?.() || settings.payroll || {},
            ...body.payroll,
            lateDeduction: {
              ...(settings.payroll?.lateDeduction?.toObject?.() || settings.payroll?.lateDeduction || {}),
              ...(body.payroll?.lateDeduction || {}),
            },
            halfDayDeduction: {
              ...(settings.payroll?.halfDayDeduction?.toObject?.() || settings.payroll?.halfDayDeduction || {}),
              ...(body.payroll?.halfDayDeduction || {}),
            },
            absentDeduction: {
              ...(settings.payroll?.absentDeduction?.toObject?.() || settings.payroll?.absentDeduction || {}),
              ...(body.payroll?.absentDeduction || {}),
            },
            overtimeRate: {
              ...(settings.payroll?.overtimeRate?.toObject?.() || settings.payroll?.overtimeRate || {}),
              ...(body.payroll?.overtimeRate || {}),
            },
            allowances: body.payroll?.allowances || settings.payroll?.allowances || [],
            deductions: body.payroll?.deductions || settings.payroll?.deductions || [],
          }
          console.log('Updated payroll settings:', settings.payroll)
        } else {
          settings[key] = body[key]
        }
      })

      await settings.save()
    } else {
      // Create new settings
      settings = await CompanySettings.create(body)
    }

    return NextResponse.json({
      success: true,
      message: 'Company settings updated successfully',
      data: settings
    })

  } catch (error) {
    console.error('Update company settings error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update company settings' },
      { status: 500 }
    )
  }
}

