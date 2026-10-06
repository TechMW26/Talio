import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { COMPANY_STORE_OPTIONS, listCompanies, saveCompany } from '@/lib/companies.server'

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, COMPANY_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    return NextResponse.json({ success: true, data: await listCompanies(auth.database) })
  } catch (error) {
    console.error('[Companies] Read failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: 'Failed to fetch companies' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, COMPANY_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const data = await saveCompany(auth.database, auth.user, await request.json())
    return NextResponse.json({ success: true, message: 'Company created successfully', data }, { status: 201 })
  } catch (error) {
    console.error('[Companies] Create failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to create company' }, { status: error.status || 500 })
  }
}
