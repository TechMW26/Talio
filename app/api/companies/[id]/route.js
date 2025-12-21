import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import Company from '@/models/Company'
import { verifyToken } from '@/lib/auth'
import { uploadImageToImageKit, deleteFromImageKit, getImageKitFolder } from '@/lib/imagekit'

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

// GET - Get single company
export async function GET(request, { params }) {
  try {
    const { id } = await params
    await connectDB()

    const company = await Company.findById(id)
      .populate('createdBy', 'email')
      .lean()

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: company,
    })
  } catch (error) {
    console.error('Get company error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch company' },
      { status: 500 }
    )
  }
}

// PUT - Update company
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]
    const decoded = await verifyToken(token)

    if (!decoded) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    // Check role - only admin or hr can update companies
    const allowedRoles = ['admin', 'hr']
    if (!allowedRoles.includes(decoded.role)) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to update companies' },
        { status: 403 }
      )
    }

    await connectDB()

    const data = await request.json()

    // Check if company exists
    const existingCompany = await Company.findById(id)
    if (!existingCompany) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      )
    }

    // Check if name or code conflicts with another company
    if (data.name || data.code) {
      const conflictingCompany = await Company.findOne({
        _id: { $ne: id },
        $or: [
          ...(data.name ? [{ name: data.name }] : []),
          ...(data.code ? [{ code: data.code.toUpperCase() }] : [])
        ]
      })

      if (conflictingCompany) {
        return NextResponse.json(
          { success: false, message: 'Another company with this name or code already exists' },
          { status: 400 }
        )
      }
    }

    // Update company
    const updateData = {}
    if (data.name) updateData.name = data.name.trim()
    if (data.code) updateData.code = data.code.trim().toUpperCase()
    if (data.description !== undefined) updateData.description = data.description.trim()
    if (data.isActive !== undefined) updateData.isActive = data.isActive

    // Handle logo upload to ImageKit if it's base64
    if (data.logo !== undefined) {
      if (data.logo && data.logo.startsWith('data:image/') && isImageKitConfigured()) {
        try {
          // Delete old logo from ImageKit if exists
          if (company.logoFileId) {
            await deleteFromImageKit(company.logoFileId).catch(() => { });
          }

          // Get folder path with company code
          const companyCode = data.code?.trim().toUpperCase() || company.code;
          const imagekitFolder = getImageKitFolder('company', { companyCode });

          const imagekitResult = await uploadImageToImageKit(data.logo, {
            fileName: `company_${companyCode}_logo_${Date.now()}.webp`,
            folder: imagekitFolder,
            tags: ['company', 'logo', companyCode],
            customMetadata: {
              companyId: id,
              companyCode: companyCode,
            },
          });
          updateData.logo = imagekitResult.url;
          updateData.logoFileId = imagekitResult.fileId;
          console.log(`[Company] Logo uploaded to ImageKit: ${imagekitFolder}`);
        } catch (imgError) {
          console.error('[Company] ImageKit logo upload failed:', imgError.message);
          updateData.logo = data.logo; // Fallback to base64
        }
      } else {
        updateData.logo = data.logo;
      }
    }

    if (data.email !== undefined) updateData.email = data.email?.trim() || ''
    if (data.phone !== undefined) updateData.phone = data.phone?.trim() || ''
    if (data.website !== undefined) updateData.website = data.website?.trim() || ''
    if (data.timezone !== undefined) updateData.timezone = data.timezone
    if (data.address !== undefined) updateData.address = data.address
    if (data.workingHours !== undefined) updateData.workingHours = data.workingHours
    // Geofencing settings
    if (data.geofence !== undefined) updateData.geofence = data.geofence
    if (data.breakTimings !== undefined) updateData.breakTimings = data.breakTimings
    // Payroll settings
    if (data.payroll !== undefined) updateData.payroll = data.payroll
    // Notification settings
    if (data.notifications !== undefined) updateData.notifications = data.notifications

    const company = await Company.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    )

    return NextResponse.json({
      success: true,
      message: 'Company updated successfully',
      data: company,
    })
  } catch (error) {
    console.error('Update company error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update company' },
      { status: 500 }
    )
  }
}

// DELETE - Delete company
export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const token = authHeader.split(' ')[1]
    const decoded = await verifyToken(token)

    if (!decoded) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      )
    }

    // Check role - only admin or hr can delete companies
    const allowedRoles = ['admin', 'hr']
    if (!allowedRoles.includes(decoded.role)) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to delete companies' },
        { status: 403 }
      )
    }

    await connectDB()

    // Soft delete by setting isActive to false
    const company = await Company.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    )

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Company deleted successfully',
    })
  } catch (error) {
    console.error('Delete company error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to delete company' },
      { status: 500 }
    )
  }
}
