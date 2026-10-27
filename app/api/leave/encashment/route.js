import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { LEAVE_BALANCE_STORE_OPTIONS } from '@/lib/leaveAllocation.server'
import { confirmEncashment, markEncashmentPaid, previewEncashment } from '@/lib/leaveEncashment.server'
import { currentFiscalYear } from '@/lib/leavePolicy'

const failure = error => NextResponse.json(
  { success: false, message: error.status ? error.message : 'Unable to process leave encashment' },
  { status: error.status || 500 }
)

export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_BALANCE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const params = new URL(request.url).searchParams
    const year = params.has('year') ? Number(params.get('year')) : currentFiscalYear()
    const data = await previewEncashment(auth.database, auth.user, { year, employeeId: params.get('employeeId') || undefined })
    return NextResponse.json({ success: true, data })
  } catch (error) { return failure(error) }
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_BALANCE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const body = await request.json().catch(() => ({}))
    const result = await confirmEncashment(auth.database, auth.user, { year: body.year, employeeIds: body.employeeIds })
    return NextResponse.json({ success: true, message: `Encashment run created ${result.created} record(s)`, data: result }, { status: 201 })
  } catch (error) { return failure(error) }
}

export async function PATCH(request) {
  try {
    const auth = await getAuthAndDatabase(request, LEAVE_BALANCE_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const body = await request.json().catch(() => ({}))
    const result = await markEncashmentPaid(auth.database, auth.user, { year: body.year, ids: body.ids, paymentReference: body.paymentReference })
    return NextResponse.json({ success: true, message: `${result.updated} encashment(s) marked paid`, data: result })
  } catch (error) { return failure(error) }
}
