import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { uploadImageToImageKit, getImageKitFolder } from '@/lib/imagekit'

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

// GET - List all companies
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Company'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Company } = models

    const companies = await Company.find({ isActive: true })
      .populate('createdBy', 'email')
      .sort({ name: 1 })
      .lean()

    return NextResponse.json({
      success: true,
      data: companies,
    })
  } catch (error) {
    console.error('Get companies error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch companies' },
      { status: 500 }
    )
  }
}

// POST - Create new company
export async function POST(request) {
  try {
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

    // Check role - only admin or hr can create companies
    const allowedRoles = ['admin', 'hr']
    if (!allowedRoles.includes(decoded.role)) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to create companies' },
        { status: 403 }
      )
    }

    const data = await request.json()

    // Validate required fields
    if (!data.name || !data.code) {
      return NextResponse.json(
        { success: false, message: 'Company name and code are required' },
        { status: 400 }
      )
    }

    // Check if company with same name or code exists
    const existingCompany = await Company.findOne({
      $or: [
        { name: data.name },
        { code: data.code.toUpperCase() }
      ]
    })

    if (existingCompany) {
      return NextResponse.json(
        { success: false, message: 'Company with this name or code already exists' },
        { status: 400 }
      )
    }

    // Handle logo upload to ImageKit if it's base64
    let logoUrl = data.logo || '';
    let logoFileId = '';

    // Get folder path with company code
    const companyCode = data.code.trim().toUpperCase();
    const imagekitFolder = getImageKitFolder('company', { companyCode });

    if (logoUrl && logoUrl.startsWith('data:image/') && isImageKitConfigured()) {
      try {
        const imagekitResult = await uploadImageToImageKit(logoUrl, {
          fileName: `company_${companyCode}_logo_${Date.now()}.webp`,
          folder: imagekitFolder,
          tags: ['company', 'logo', companyCode],
          customMetadata: {
            companyCode: companyCode,
          },
        });
        logoUrl = imagekitResult.url;
        logoFileId = imagekitResult.fileId;
        console.log(`[Company] Logo uploaded to ImageKit: ${imagekitFolder}`);
      } catch (imgError) {
        console.error('[Company] ImageKit logo upload failed:', imgError.message);
        // Keep the base64 as fallback (not recommended)
      }
    }

    const company = await Company.create({
      name: data.name.trim(),
      code: data.code.trim().toUpperCase(),
      description: data.description?.trim() || '',
      logo: logoUrl,
      logoFileId: logoFileId,
      email: data.email?.trim() || '',
      phone: data.phone?.trim() || '',
      website: data.website?.trim() || '',
      timezone: data.timezone || 'Asia/Kolkata',
      address: data.address || {
        street: '',
        city: '',
        state: '',
        country: '',
        zipCode: ''
      },
      workingHours: data.workingHours || {
        checkInTime: '09:00',
        checkOutTime: '18:00',
        lateThresholdMinutes: 15,
        absentThresholdMinutes: 60,
        halfDayHours: 4,
        fullDayHours: 8,
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      },
      createdBy: decoded.userId
    })

    return NextResponse.json({
      success: true,
      message: 'Company created successfully',
      data: company,
    }, { status: 201 })
  } catch (error) {
    console.error('Create company error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to create company' },
      { status: 500 }
    )
  }
}
