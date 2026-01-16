import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { emitDocumentUpdate } from '@/lib/realtimeEvents'
// GET - List documents
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Document'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Document } = models

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const category = searchParams.get('category')

    const query = {}

    if (employeeId) {
      query.employee = employeeId
    }

    if (category) {
      query.category = category
    }

    const documents = await Document.find(query)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('uploadedBy', 'firstName lastName')
      .sort({ createdAt: -1 })

    return NextResponse.json({
      success: true,
      data: documents,
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
    const auth = await getAuthAndModels(request, ['Document'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Document } = models

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

