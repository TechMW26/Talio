import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

const DOCUMENT_MANAGER_ROLES = ['admin', 'super_admin', 'hr']

async function canAccessDocument(user, User, document) {
  if (DOCUMENT_MANAGER_ROLES.includes(user.role)) return true
  const actor = await User.findById(user._id || user.userId).select('employeeId').lean()
  return Boolean(actor?.employeeId && document?.employee && String(actor.employeeId) === String(document.employee?._id || document.employee))
}

// GET - Get single document
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Document', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Document, User } = models
    const { id } = await params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid document id' }, { status: 400 })
    }

    const document = await Document.findById(id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('uploadedBy', 'firstName lastName')

    if (!document) {
      return NextResponse.json(
        { success: false, message: 'Document not found' },
        { status: 404 }
      )
    }

    if (!(await canAccessDocument(user, User, document))) {
      return NextResponse.json({ success: false, message: 'You do not have access to this document' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      data: document,
    })
  } catch (error) {
    console.error('Get document error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch document' },
      { status: 500 }
    )
  }
}

// PUT - Update document
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Document', 'Employee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Document, Employee, User } = models
    const { id } = await params

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, message: 'Invalid document id' }, { status: 400 })
    }

    const existingDocument = await Document.findById(id).select('employee generatedLetter onboardingItemKey').lean()
    if (!existingDocument) {
      return NextResponse.json({ success: false, message: 'Document not found' }, { status: 404 })
    }
    if (!(await canAccessDocument(user, User, existingDocument))) {
      return NextResponse.json({ success: false, message: 'You do not have access to this document' }, { status: 403 })
    }

    const input = await request.json()
    if (existingDocument.generatedLetter) return NextResponse.json({ success: false, message: 'Issued letters cannot be edited. Issue a revised letter from the employee profile.' }, { status: 409 })
    if (input.status && (!DOCUMENT_MANAGER_ROLES.includes(user.role) || existingDocument.onboardingItemKey)) {
      return NextResponse.json({ success: false, message: existingDocument.onboardingItemKey ? 'Review onboarding submissions from the employee lifecycle checklist' : 'Only HR can review documents' }, { status: 403 })
    }
    const data = Object.fromEntries(['name', 'description', 'category', 'expiryDate', ...(DOCUMENT_MANAGER_ROLES.includes(user.role) ? ['status'] : [])].filter(key => input[key] !== undefined).map(key => [key, input[key]]))
    if (data.status && !['approved', 'rejected'].includes(data.status)) return NextResponse.json({ success: false, message: 'Invalid document status' }, { status: 400 })

    const document = await Document.findByIdAndUpdate(
      id,
      data,
      { new: true, runValidators: true }
    )
      .populate('employee', 'firstName lastName employeeCode')
      .populate('uploadedBy', 'firstName lastName')

    if (!document) {
      return NextResponse.json(
        { success: false, message: 'Document not found' },
        { status: 404 }
      )
    }

    // Emit Socket.IO event for document updates
    try {
      const io = global.io
      if (io && (data.status === 'approved' || data.status === 'rejected')) {
        const employeeDoc = await Employee.findById(document.employee._id || document.employee).select('userId')
        const employeeUserId = employeeDoc?.userId

        if (employeeUserId) {
          const icon = data.status === 'approved' ? '✅' : '❌'

          // Socket.IO event
          io.to(`user:${employeeUserId}`).emit('document-update', {
            document,
            action: data.status,
            message: `Document "${document.name}" has been ${data.status}`,
            timestamp: new Date()
          })
          console.log(`✅ [Socket.IO] Document update sent to user:${employeeUserId}`)

          // FCM push notification
          try {
            await sendPushToUser(
              employeeUserId,
              {
                title: `${icon} Document ${data.status === 'approved' ? 'Approved' : 'Rejected'}`,
                body: `Document "${document.name}" has been ${data.status}`,
              },
              {
                clickAction: '/dashboard/documents',
                eventType: 'document_update',
                data: {
                  documentId: document._id.toString(),
                  status: data.status,
                  type: 'document_update'
                }
              }
            )
            console.log(`📲 [FCM] Document notification sent to user:${employeeUserId}`)
          } catch (fcmError) {
            console.error('Failed to send document FCM notification:', fcmError)
          }
        }
      }
    } catch (socketError) {
      console.error('Failed to send document socket notification:', socketError)
    }

    return NextResponse.json({
      success: true,
      message: 'Document updated successfully',
      data: document,
    })
  } catch (error) {
    console.error('Update document error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to update document' },
      { status: 500 }
    )
  }
}

// DELETE - Delete document
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Document', 'User'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { Document, User } = auth.models
    const { id } = await params

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, message: 'Invalid document id' },
        { status: 400 }
      )
    }

    const existingDocument = await Document.findById(id).select('employee generatedLetter').lean()
    if (!existingDocument) {
      return NextResponse.json({ success: false, message: 'Document not found' }, { status: 404 })
    }
    if (!(await canAccessDocument(auth.user, User, existingDocument))) {
      return NextResponse.json({ success: false, message: 'You do not have access to this document' }, { status: 403 })
    }
    if (existingDocument.generatedLetter && !DOCUMENT_MANAGER_ROLES.includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Contact HR to remove an issued employment letter' }, { status: 403 })

    const document = await Document.findByIdAndDelete(id)

    if (!document) {
      return NextResponse.json(
        { success: false, message: 'Document not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Document deleted successfully',
    })
  } catch (error) {
    console.error('Delete document error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to delete document' },
      { status: 500 }
    )
  }
}

