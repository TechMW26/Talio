import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { DESIGNATION_STORE_OPTIONS, assertDesignationId, saveDesignation, deleteDesignation } from '@/lib/designations.server'

const failure = error => NextResponse.json({ success: false, message: error.status ? error.message : error.code === 'ALREADY_EXISTS' ? 'Designation title or code is already in use' : 'Unable to load or update designation' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500) })
async function handle(request, params, action) {
  try {
    const auth = await getAuthAndDatabase(request, DESIGNATION_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { id } = await params
    assertDesignationId(id)
    return await action(auth, id)
  } catch (error) { return failure(error) }
}
export async function GET(request, { params }) {
  return handle(request, params, async (auth, id) => {
    const data = await auth.database.get('designations', id)
    return data ? NextResponse.json({ success: true, data }) : NextResponse.json({ success: false, message: 'Designation not found' }, { status: 404 })
  })
}
export async function PUT(request, { params }) {
  return handle(request, params, async (auth, id) => NextResponse.json({ success: true, message: 'Designation updated successfully', data: await saveDesignation(auth.database, auth.user, await request.json(), id) }))
}
export async function DELETE(request, { params }) {
  return handle(request, params, async (auth, id) => {
    await deleteDesignation(auth.database, auth.user, id)
    return NextResponse.json({ success: true, message: 'Designation deleted successfully' })
  })
}

