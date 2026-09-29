import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { INDUCTION_MODELS, inductionStatus, publicInductionStatus, updateInductionProgress } from '@/lib/hrms/induction.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, INDUCTION_MODELS)
    if (!auth.success) return NextResponse.json({ success: false, message: 'Sign in to continue' }, { status: 401 })
    return NextResponse.json({ success: true, data: publicInductionStatus(await inductionStatus(auth)) })
  } catch { return NextResponse.json({ success: false, message: 'Unable to check induction. Please retry.' }, { status: 500 }) }
}
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, INDUCTION_MODELS)
    if (!auth.success) return NextResponse.json({ success: false, message: 'Sign in to continue' }, { status: 401 })
    await updateInductionProgress(auth, await request.json())
    return NextResponse.json({ success: true, data: publicInductionStatus(await inductionStatus(auth)) })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to save induction progress. Please retry.' }, { status: error.status || 500 }) }
}
