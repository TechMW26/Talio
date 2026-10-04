import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getFirestoreMediaRepository } from '@/lib/platform/firestoreMedia.server'
export const dynamic = 'force-dynamic'

// Legacy URL compatibility uses the current tenant's verified profile references.
// Filesystem paths are never opened; all binary reads come from private Blob.
export async function GET(request, context) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ message: auth.message }, { status: auth.status || 401 })
    const { path: segments } = await context.params
    if (!Array.isArray(segments) || segments.length !== 2 || segments.some(value => !value || value.includes('..') || value.includes('/') || value.includes('\\'))) return NextResponse.json({ message: 'Invalid document path' }, { status: 400 })
    const [owner, filename] = segments, actorId = String(auth.user._id || auth.user.userId)
    if (owner !== actorId && !['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ message: 'Not authorized to access this document' }, { status: 403 })
    const user = await auth.database.get('users', owner)
    if (!user) return NextResponse.json({ message: 'Document not found' }, { status: 404 })
    const media = await getFirestoreMediaRepository(auth.tenant.databaseName)
    for (const document of [user.profileCompletion?.aadhaarFront, user.profileCompletion?.aadhaarBack]) {
      const fileId = document?.fileId || /^\/api\/images\/([a-f\d]{24})$/i.exec(String(document?.url || ''))?.[1]
      if (!/^[a-f\d]{24}$/i.test(String(fileId || ''))) continue
      const info = await media.info('images', fileId)
      const matches = [info?.file.filename, info?.file.metadata?.originalName, String(document?.url || '').split('/').at(-1)].includes(filename)
      if (!matches) continue
      const result = await media.open('images', fileId, () => true)
      if (!result) continue
      return new Response(result.stream, { headers: { 'Content-Type': result.contentType, 'Content-Length': String(result.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
    }
    return NextResponse.json({ success: false, message: 'This legacy document link has no migrated private-storage reference. Open the current document from the profile.' }, { status: 404 })
  } catch (error) {
    console.error('[Aadhaar File Serve]', error.message)
    return NextResponse.json({ success: false, message: 'Document storage is unavailable' }, { status: 503 })
  }
}
