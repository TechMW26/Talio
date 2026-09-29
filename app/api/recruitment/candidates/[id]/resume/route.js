import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { readCandidateResume } from '@/lib/recruitment/wordpressResume.server'
export const dynamic = 'force-dynamic'
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Candidate'])
    if (!auth.success) return new NextResponse('Unauthorized', { status: 401 })
    if (!['admin', 'hr', 'manager', 'super_admin', 'superadmin'].includes(auth.user.role)) return new NextResponse('Forbidden', { status: 403 })
    const { id } = await params, result = await readCandidateResume(auth, id)
    return new NextResponse(result.bytes, { headers: { 'Content-Type': result.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) { return new NextResponse(error.status ? error.message : 'Resume could not be loaded', { status: error.status || 500 }) }
}
