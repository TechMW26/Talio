import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { DESIGNATION_STORE_OPTIONS, assertDesignationManager, listDesignations, saveDesignation } from '@/lib/designations.server'

const failure = error => NextResponse.json({ success: false, message: error.status ? error.message : error.code === 'ALREADY_EXISTS' ? 'Designation title or code is already in use' : 'Unable to save or load designations' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500) })

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, DESIGNATION_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    assertDesignationManager(auth.user)
    return NextResponse.json({ success: true, data: await listDesignations(auth.database) })
  } catch (error) { return failure(error) }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, DESIGNATION_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const data = await saveDesignation(auth.database, auth.user, await request.json())
    return NextResponse.json({ success: true, message: 'Designation created successfully', data }, { status: 201 })
  } catch (error) { return failure(error) }
}

