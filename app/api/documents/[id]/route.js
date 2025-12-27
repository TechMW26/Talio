import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

// GET - Get single document
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Document'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Document } = models

    const document = await Document.findById(params.id)
      .populate('employee', 'firstName lastName employeeCode')
      .populate('uploadedBy', 'firstName lastName')

    if (!document) {
      return NextResponse.json(
        { success: false, message: 'Document not found' },
        { status: 404 }
      )
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
    const auth = await getAuthAndModels(request, ['Document', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Document, Employee } = models

    const data = await request.json()

    const document = await Document.findByIdAndUpdate(
      params.id,
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
    const document = await Document.findByIdAndDelete(params.id)

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
      { success: false, message: 'Failed to delete document' },
      { status: 500 }
    )
  }
}

