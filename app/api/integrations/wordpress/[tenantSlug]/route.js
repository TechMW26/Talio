import { NextResponse } from 'next/server'
import { wordpressAuth, wordpressFeed, importWordpressJob, importWordpressApplication, syncError, WORDPRESS_COLLECTION } from '@/lib/recruitment/wordpress.server'
import { prepareResume, receiveResumeChunk, completeResume, readCandidateResume } from '@/lib/recruitment/wordpressResume.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = data => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } })
function failed(error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Sync is temporarily unavailable. Retry shortly.' }, { status: error.status || 503 }) }
export async function GET(request, { params }) {
  try {
    const { tenantSlug } = await params, auth = await wordpressAuth(request, tenantSlug)
    const search = new URL(request.url).searchParams
    if (search.get('action') === 'resume') {
      const result = await readCandidateResume(auth, search.get('candidateId'))
      return new NextResponse(result.bytes, { headers: { 'Content-Type': result.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
    }
    if (search.get('action') === 'job') {
      const { serializeJob } = await import('@/lib/recruitment/wordpress.server')
      const id = search.get('id')
      if (!/^[a-f0-9]{24}$/i.test(id || '')) throw syncError('Invalid job')
      const job = await auth.store.get('jobpostings', id)
      if (!job) throw syncError('Job not found', 404)
      return json(serializeJob(job))
    }
    if (search.get('action') === 'ping') return json({ connected: true, siteUrl: auth.integration.siteUrl })
    return json(await wordpressFeed(auth, { kind: search.get('kind'), cursor: search.get('cursor') }))
  } catch (error) { return failed(error) }
}
export async function POST(request, { params }) {
  try {
    const { tenantSlug } = await params, auth = await wordpressAuth(request, tenantSlug)
    // Bounded bodies, including chunk uploads, stay below serverless request limits.
    const reader = request.body?.getReader(), parts = []; let size = 0
    if (!reader) throw syncError('Request body is required')
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); throw syncError('Sync request exceeds 1 MB', 413) } parts.push(Buffer.from(value)) }
    let input
    try { input = JSON.parse(Buffer.concat(parts).toString()) } catch { throw syncError('Invalid JSON') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw syncError('Expected a sync request object')
    let result
    if (input.action === 'job') result = await importWordpressJob(auth, input)
    else if (input.action === 'application') result = await importWordpressApplication(auth, input)
    else if (input.action === 'resume-prepare') result = await prepareResume(auth, input)
    else if (input.action === 'resume-chunk') result = await receiveResumeChunk(auth, input)
    else if (input.action === 'resume-complete') result = await completeResume(auth, input)
    else if (input.action === 'checkpoint') {
      await auth.store.mutate(WORDPRESS_COLLECTION, 'wordpress', current => ({ ...current, lastSyncAt: new Date(), lastError: String(input.error || '').slice(0, 500) }))
      result = { saved: true }
    } else throw syncError('Invalid sync action')
    return json(result)
  } catch (error) { return failed(error) }
}
