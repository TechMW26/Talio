import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { INDUCTION_MODELS, inductionStatus, readInductionSource } from '@/lib/hrms/induction.server'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, INDUCTION_MODELS)
    if (!auth.success) return new NextResponse('Unauthorized', { status: 401 })
    const { program, employee, canManage } = await inductionStatus(auth)
    if (!employee && !canManage) return new NextResponse('Forbidden', { status: 403 })
    if (!program || (!program.active && !canManage) || new URL(request.url).searchParams.get('version') !== program.version) return new NextResponse('Presentation changed; reload to continue', { status: 409 })
    const { bytes } = await readInductionSource(auth, program.source)
    return new NextResponse(bytes, { headers: { 'Content-Type': program.source.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new NextResponse('Unable to load the presentation', { status: 500 }) }
}
