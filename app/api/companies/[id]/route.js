import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { COMPANY_STORE_OPTIONS, saveCompany, populateCompanies } from '@/lib/companies.server'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    if (!/^[a-f\d]{24}$/i.test(id)) return NextResponse.json({ success: false, message: 'Invalid company id' }, { status: 400 })
    const auth = await getAuthAndDatabase(request, COMPANY_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const record = await auth.database.get('companies', id)
    if (!record) return NextResponse.json({ success: false, message: 'Company not found' }, { status: 404 })
    return NextResponse.json({ success: true, data: (await populateCompanies(auth.database, [record]))[0] })
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Failed to fetch company' }, { status: 500 })
  }
}

async function save(request, params, remove) {
  try {
    const { id } = await params
    const auth = await getAuthAndDatabase(request, COMPANY_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const data = await saveCompany(auth.database, auth.user, remove ? { isActive: false } : await request.json(), id)
    await Promise.all(['company-settings', 'dashboard:unified', 'settings:company'].map(namespace => clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace, userId: '*' })).catch(() => {})))
    return NextResponse.json({ success: true, message: remove ? 'Company deleted successfully' : 'Company updated successfully', ...(remove ? {} : { data }) })
  } catch (error) {
    console.error('[Companies] Save failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to save company' }, { status: error.status || 500 })
  }
}
export const PUT = (request, { params }) => save(request, params, false)
export const DELETE = (request, { params }) => save(request, params, true)
