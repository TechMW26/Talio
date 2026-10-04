import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { saveMeetingAudio, readMeetingAudio, deleteMeetingAudio, validateAudioSegment } from '@/lib/platform/firestoreMeetingAudio.server'

export const dynamic = 'force-dynamic'
const fail = (message, status) => Object.assign(new Error(message), { status })
function isMember(meeting, employeeId) {
  return String(meeting.organizer) === employeeId || (meeting.invitees || []).some(invitee => String(invitee.employee) === employeeId)
}
function requireRecordingConsent(meeting, employeeId) {
  if (!isMember(meeting, employeeId)) throw fail('You are not part of this meeting', 403)
  const invitee = (meeting.invitees || []).find(value => String(value.employee) === employeeId)
  if (meeting.type === 'offline' && invitee && !invitee.audioConsent) throw fail('Audio consent required for offline meeting recording', 403)
}
async function context(request, params) {
  const auth = await verifyTokenFromRequest(request)
  if (!auth.success) throw fail('Unauthorized', 401)
  const { id } = await params
  if (!/^[a-f0-9]{24}$/i.test(id || '')) throw fail('Meeting not found', 404)
  const store = await getFirestoreTenantDatabase(auth.tenant.databaseName, { queryFields: { employees: ['userId'] } })
  const userId = String(auth.user._id || auth.user.userId)
  const user = await store.get('users', userId)
  const employee = user?.employeeId ? await store.get('employees', String(user.employeeId)) : (await store.list('employees', { filters: [{ field: 'userId', operator: '==', value: userId }], limit: 1 })).records[0]
  const meeting = await store.get('meetings', id)
  if (!employee || !meeting) throw fail('Meeting or employee not found', 404)
  return { auth, id, store, meeting, employeeId: String(employee._id) }
}
function errorResponse(error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Meeting audio unavailable' }, { status: error.status || 500 }) }

export async function POST(request, { params }) {
  try {
    const { auth, id, store, meeting, employeeId } = await context(request, params)
    const form = await request.formData(), file = form.get('audio'), duration = parseFloat(form.get('duration') || '0')
    const invalid = validateAudioSegment(file, duration)
    if (invalid) throw fail(invalid, 400)
    requireRecordingConsent(meeting, employeeId)
    const fileId = await saveMeetingAudio({ databaseName: auth.tenant.databaseName, meetingId: id, employeeId, file })
    const url = `/api/meetings/${id}/audio?segment=${fileId}`
    let saved
    try {
      saved = await store.mutate('meetings', id, current => {
        requireRecordingConsent(current, employeeId)
        const offlineAudio = current.offlineAudio || { segments: [], processingStatus: 'pending' }
        return { ...current, offlineAudio: { ...offlineAudio, segments: [...(offlineAudio.segments || []), { employee: employeeId, url, duration, uploadedAt: new Date() }] }, updatedAt: new Date() }
      })
      if (!saved) throw fail('Meeting no longer exists', 404)
    } catch (error) { await deleteMeetingAudio(auth.tenant.databaseName, fileId).catch(() => {}); throw error }
    return NextResponse.json({ success: true, message: 'Audio uploaded successfully', data: { url, segmentCount: saved.offlineAudio.segments.length } })
  } catch (error) { return errorResponse(error) }
}
export async function PUT(request, { params }) {
  try {
    const { store, id, employeeId } = await context(request, params)
    const { consent } = await request.json()
    if (typeof consent !== 'boolean') throw fail('Audio consent must be true or false', 400)
    await store.mutate('meetings', id, current => {
      const index = (current.invitees || []).findIndex(invitee => String(invitee.employee) === employeeId)
      if (index < 0) throw fail('You are not invited to this meeting', 403)
      current.invitees[index].audioConsent = consent
      return { ...current, updatedAt: new Date() }
    })
    return NextResponse.json({ success: true, message: consent ? 'Audio consent granted' : 'Audio consent revoked', data: { audioConsent: consent } })
  } catch (error) { return errorResponse(error) }
}
export async function GET(request, { params }) {
  try {
    const { auth, id, meeting, employeeId } = await context(request, params)
    if (!isMember(meeting, employeeId)) throw fail('Forbidden', 403)
    const segment = new URL(request.url).searchParams.get('segment')
    const result = await readMeetingAudio(auth.tenant.databaseName, id, segment)
    if (!result) throw fail('Audio not found', 404)
    return new NextResponse(result.stream, { headers: { 'Content-Type': result.contentType, 'Content-Length': String(result.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) { return errorResponse(error) }
}
