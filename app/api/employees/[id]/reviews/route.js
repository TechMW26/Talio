import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { listEmployeeReviews, addEmployeeReview, deleteEmployeeReview } from '@/lib/employeeReviews.server'

async function handle(request, params, action) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const { id } = await params
    if (!/^[a-f\d]{24}$/i.test(id)) return NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 })
    return await action(auth, id)
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to load or update reviews' }, { status: error.status || 500 }) }
}
export async function GET(request, { params }) {
  return handle(request, params, async (auth, id) => NextResponse.json({ success: true, data: await listEmployeeReviews(auth.database, auth.user, id) }))
}
export async function POST(request, { params }) {
  return handle(request, params, async (auth, id) => NextResponse.json({ success: true, message: 'Review added successfully', data: await addEmployeeReview(auth.database, auth.user, id, await request.json()) }, { status: 201 }))
}
export async function DELETE(request, { params }) {
  return handle(request, params, async (auth, id) => {
    await deleteEmployeeReview(auth.database, auth.user, id, new URL(request.url).searchParams.get('reviewId'))
    return NextResponse.json({ success: true, message: 'Review deleted successfully' })
  })
}

