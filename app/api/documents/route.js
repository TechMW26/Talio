import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitDocumentUpdate } from '@/lib/realtimeEvents'
import mongoose from 'mongoose'

// GET - List documents
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Document', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Document, User, Employee } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const category = searchParams.get('category')

    const query = {}
    const managerRoles = ['admin', 'super_admin', 'hr']
    const canManageDocuments = managerRoles.includes(user.role)
    const actorUser = await User.findById(user._id || user.userId).select('employeeId').lean()
    const actorEmployeeId = actorUser?.employeeId || user.employeeId

    if (employeeId && !mongoose.Types.ObjectId.isValid(employeeId)) {
      return NextResponse.json({ success: false, message: 'Invalid employee id' }, { status: 400 })
    }
    if (!canManageDocuments && employeeId && String(actorEmployeeId || '') !== employeeId) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }
    if (!canManageDocuments) {
      if (!actorEmployeeId) {
        return NextResponse.json({ success: true, data: [] })
      }
      query.employee = actorEmployeeId
    } else if (employeeId) {
      if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        return NextResponse.json({ success: false, message: 'Invalid employee id' }, { status: 400 })
      }
      query.employee = employeeId
    }

    if (category) {
      query.category = category
    }

    const documents = await Document.find(query)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('uploadedBy', 'firstName lastName')
      .sort({ createdAt: -1 })

    // Convert to plain objects
    let allDocuments = documents.map(doc => doc.toObject ? doc.toObject() : doc)

    // Use the authorized employee scope for both document stores.
    if (!category || category === 'identity') {
      const profileQuery = {
        ...(query.employee ? { employeeId: query.employee } : { employeeId: { $ne: null } }),
        $or: [
          { 'profileCompletion.aadhaarFront.url': { $exists: true, $ne: '' } },
          { 'profileCompletion.aadhaarBack.url': { $exists: true, $ne: '' } },
        ],
      }
      const profiles = await User.find(profileQuery)
        .select('employeeId profileCompletion.aadhaarFront profileCompletion.aadhaarBack profileCompletion.firstLoginAt')
        .lean()
      const employees = profiles.length
        ? await Employee.find({ _id: { $in: profiles.map(profile => profile.employeeId) } })
          .select('firstName lastName employeeCode').lean()
        : []
      const employeeMap = new Map(employees.map(employee => [String(employee._id), employee]))
      for (const profile of profiles) {
        const employee = employeeMap.get(String(profile.employeeId))
        if (!employee) continue
        for (const side of ['Front', 'Back']) {
          const file = profile.profileCompletion?.[`aadhaar${side}`]
          if (!file?.url) continue
          allDocuments.push({
            _id: `aadhaar-${side.toLowerCase()}-${profile.employeeId}`,
            name: `Aadhaar Card (${side})`, fileName: `Aadhaar Card (${side})`,
            category: 'identity', url: file.url, fileUrl: file.url, fileId: file.fileId,
            type: 'image', fileType: 'image', employee,
            uploadedBy: null, uploadedByLabel: 'Employee self-service',
            createdAt: file.uploadedAt || profile.profileCompletion.firstLoginAt,
            updatedAt: file.uploadedAt || profile.profileCompletion.firstLoginAt,
            isAadhaarDocument: true, isSystemGenerated: true,
          })
        }
      }
      allDocuments.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    }

    return NextResponse.json({
      success: true,
      data: allDocuments,
    })
  } catch (error) {
    console.error('Get documents error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch documents' },
      { status: 500 }
    )
  }
}

// POST - Upload document
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Document', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Document, User, Employee } = models

    let data = await request.json()

    // Map new format fields to required schema fields
    // Support both new format (fileUrl/fileType/fileName) and legacy format (url/type/name)
    if (data.fileUrl) data.url = data.fileUrl
    if (data.fileType) data.type = data.fileType
    if (data.fileName) data.name = data.fileName

    // Validate required fields
    if (!data.name || !data.type || !data.url) {
      return NextResponse.json(
        { success: false, message: 'Document name, type, and url are required' },
        { status: 400 }
      )
    }

    const managerRoles = ['admin', 'super_admin', 'hr']
    const canManageDocuments = managerRoles.includes(user.role)
    const actorUser = await User.findById(auth.user._id || auth.user.userId).select('employeeId').lean()
    const actorEmployee = actorUser?.employeeId
      ? await Employee.findById(actorUser.employeeId).select('_id').lean()
      : await Employee.findOne({ userId: auth.user._id || auth.user.userId }).select('_id').lean()
    if (!actorEmployee?._id && !canManageDocuments) {
      return NextResponse.json({ success: false, message: 'Uploader employee profile not found' }, { status: 400 })
    }

    if (!canManageDocuments) {
      data.employee = actorEmployee._id
    }
    if (data.employee && !mongoose.Types.ObjectId.isValid(String(data.employee))) {
      return NextResponse.json({ success: false, message: 'Invalid employee id' }, { status: 400 })
    }
    if (data.employee && !(await Employee.exists({ _id: data.employee }))) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }
    data.uploadedBy = actorEmployee?._id
    data.isCompanyDocument = canManageDocuments && !data.employee

    const document = await Document.create(data)

    const populatedDocument = await Document.findById(document._id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('uploadedBy', 'firstName lastName')

    // Emit real-time event
    emitDocumentUpdate(populatedDocument.toObject ? populatedDocument.toObject() : populatedDocument, [], { action: 'create', broadcast: true })

    return NextResponse.json({
      success: true,
      message: 'Document uploaded successfully',
      data: populatedDocument,
    }, { status: 201 })
  } catch (error) {
    console.error('Upload document error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to upload document' },
      { status: 500 }
    )
  }
}

