import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { inductionStatus, publicInductionStatus, updateInductionProgress } from '@/lib/hrms/induction.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: 'Sign in to continue' }, { status: 401 })
    return NextResponse.json({ success: true, data: publicInductionStatus(await inductionStatus(auth)) })
  } catch { return NextResponse.json({ success: false, message: 'Unable to check induction. Please retry.' }, { status: 500 }) }
}
export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: 'Sign in to continue' }, { status: 401 })
    await updateInductionProgress(auth, await request.json())
    return NextResponse.json({ success: true, data: publicInductionStatus(await inductionStatus(auth)) })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to save induction progress. Please retry.' }, { status: error.status || 500 }) }
}
