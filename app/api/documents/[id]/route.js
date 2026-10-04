import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { sendNotificationToUser } from '@/lib/firebaseNotification'
import { DOCUMENT_STORE_OPTIONS, isDocumentId, getDocumentActor, assertDocumentAccess, populateDocuments, updateDocument } from '@/lib/documents.server'

function failure(error, message) {
  console.error('[Documents] Request failed:', error.code || error.name)
  return NextResponse.json({ success: false, message: error.status ? error.message : message }, { status: error.status || 500 })
}

export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request, DOCUMENT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const { id } = await params
    if (!isDocumentId(id)) return NextResponse.json({ success: false, message: 'Invalid document id' }, { status: 400 })
    const document = await auth.database.get('documents', id)
    if (!document) return NextResponse.json({ success: false, message: 'Document not found' }, { status: 404 })
    assertDocumentAccess(await getDocumentActor(auth.database, auth.user), document)
    return NextResponse.json({ success: true, data: (await populateDocuments(auth.database, [document]))[0] })
  } catch (error) { return failure(error, 'Failed to fetch document') }
}

export async function PUT(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request, DOCUMENT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const { id } = await params
    const input = await request.json()
    const record = await updateDocument(auth.database, auth.user, id, input)
    const document = (await populateDocuments(auth.database, [record]))[0]
    // External delivery runs after the Firestore transaction has committed.
    if (input.status && record.employee) {
      try {
        const employee = await auth.database.get('employees', String(record.employee))
        if (employee?.userId) {
          global.io?.to(`user:${employee.userId}`).emit('document-update', { document, action: input.status, message: `Document "${document.name}" has been ${input.status}`, timestamp: new Date() })
          const recipient = await auth.database.get('users', String(employee.userId))
          if (recipient) {
            const delivery = await sendNotificationToUser(recipient, { title: `Document ${input.status === 'approved' ? 'Approved' : 'Rejected'}`, body: `Document "${document.name}" has been ${input.status}` }, { url: '/dashboard/documents', eventType: 'document_update', documentId: id, status: input.status, type: 'document_update' })
            if (delivery.tokensToRemove?.length) await auth.database.mutate('users', recipient._id, current => ({ ...current, fcmTokens: (current.fcmTokens || []).filter(entry => !delivery.tokensToRemove.includes(entry.token)) }))
          }
        }
      } catch (error) { console.error('[Documents] Delivery failed:', error.code || error.name) }
    }
    return NextResponse.json({ success: true, message: 'Document updated successfully', data: document })
  } catch (error) { return failure(error, 'Failed to update document') }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndDatabase(request, DOCUMENT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { id } = await params
    await updateDocument(auth.database, auth.user, id, {}, { remove: true })
    return NextResponse.json({ success: true, message: 'Document deleted successfully' })
  } catch (error) { return failure(error, 'Failed to delete document') }
}

