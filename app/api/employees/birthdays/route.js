import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'

export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, { queryFields: { employees: ['status', 'designationLevel'] } })
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const records = await collectFirestorePages(auth.database, 'employees', { filters: [{ field: 'status', operator: '==', value: 'active' }] })
    const fields = ['_id', 'firstName', 'lastName', 'employeeCode', 'dateOfBirth']
    const data = records.filter(record => record.dateOfBirth && Number.isFinite(new Date(record.dateOfBirth).getTime()))
      .sort((a, b) => String(a.firstName || '').localeCompare(String(b.firstName || '')))
      .map(record => Object.fromEntries(fields.filter(key => record[key] !== undefined).map(key => [key, record[key]])))
    return NextResponse.json({ success: true, data })
  } catch { return NextResponse.json({ success: false, message: 'Failed to fetch birthdays' }, { status: 500 }) }
}
