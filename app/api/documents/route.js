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

    // Convert to plain objects
    let allDocuments = documents.map(doc => doc.toObject ? doc.toObject() : doc)

    // If fetching for a specific employee, also include Aadhaar documents from User's profileCompletion
    if (employeeId && (!category || category === 'identity')) {
      try {
        // Convert employeeId to ObjectId if valid
        const employeeObjectId = mongoose.Types.ObjectId.isValid(employeeId) 
          ? new mongoose.Types.ObjectId(employeeId) 
          : employeeId

        // Find the user with this employeeId
        const userWithAadhaar = await User.findOne({ employeeId: employeeObjectId })
          .select('profileCompletion')
          .lean()

        if (userWithAadhaar?.profileCompletion) {
          const { aadhaarFront, aadhaarBack } = userWithAadhaar.profileCompletion
          
          // Get employee details for the document
          const employee = await Employee.findById(employeeId).select('firstName lastName employeeCode').lean()

          // Add Aadhaar Front if it exists
          if (aadhaarFront?.url) {
            allDocuments.push({
              _id: `aadhaar-front-${employeeId}`,
              name: 'Aadhaar Card (Front)',
              fileName: 'Aadhaar Card (Front)',
              category: 'identity',
              url: aadhaarFront.url,
              fileUrl: aadhaarFront.url,
              fileId: aadhaarFront.fileId,
              type: 'image',
              fileType: 'image',
              employee: employee,
              uploadedBy: employee,
              createdAt: aadhaarFront.uploadedAt || userWithAadhaar.profileCompletion.firstLoginAt || new Date(),
              updatedAt: aadhaarFront.uploadedAt || userWithAadhaar.profileCompletion.firstLoginAt || new Date(),
              isAadhaarDocument: true,
              isSystemGenerated: true,
            })
          }

          // Add Aadhaar Back if it exists
          if (aadhaarBack?.url) {
            allDocuments.push({
              _id: `aadhaar-back-${employeeId}`,
              name: 'Aadhaar Card (Back)',
              fileName: 'Aadhaar Card (Back)',
              category: 'identity',
              url: aadhaarBack.url,
              fileUrl: aadhaarBack.url,
              fileId: aadhaarBack.fileId,
              type: 'image',
              fileType: 'image',
              employee: employee,
              uploadedBy: employee,
              createdAt: aadhaarBack.uploadedAt || userWithAadhaar.profileCompletion.firstLoginAt || new Date(),
              updatedAt: aadhaarBack.uploadedAt || userWithAadhaar.profileCompletion.firstLoginAt || new Date(),
              isAadhaarDocument: true,
              isSystemGenerated: true,
            })
          }
        }
      } catch (aadhaarError) {
        // Log but don't fail the whole request if Aadhaar fetch fails
        console.error('Error fetching Aadhaar documents:', aadhaarError)
      }

      // Sort all documents by createdAt (newest first)
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

