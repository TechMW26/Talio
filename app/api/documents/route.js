import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { emitDocumentUpdate } from '@/lib/realtimeEvents'
import { DOCUMENT_STORE_OPTIONS, listDocuments, createDocument } from '@/lib/documents.server'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, DOCUMENT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const { searchParams } = new URL(request.url)
    const data = await listDocuments(auth.database, auth.user, { employeeId: searchParams.get('employeeId'), category: searchParams.get('category') })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[Documents] List failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to fetch documents' }, { status: error.status || 500 })
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, DOCUMENT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const data = await createDocument(auth.database, auth.user, await request.json())
    emitDocumentUpdate(data, [], { action: 'create', broadcast: true })
    return NextResponse.json({ success: true, message: 'Document uploaded successfully', data }, { status: 201 })
  } catch (error) {
    console.error('[Documents] Create failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to upload document' }, { status: error.status || 500 })
  }
}

