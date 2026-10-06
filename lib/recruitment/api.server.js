import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { collectFirestorePages } from '@/lib/platform/firestoreQueries.server'
import { RECRUITMENT_ROLES, STAGES, recruitmentError, recruitmentId, getRecruitmentDatabase, listRecruitment, populateRecruitment, saveJob, saveCandidate, saveInterview, canReadInterview, deleteRecruitmentRecord, eq } from './store.server'

export function recruitmentHandler(collection, method, detail = false) {
  return async (request, context = {}) => {
    try {
      const auth = await getAuthAndDatabase(request)
      if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
      const database = await getRecruitmentDatabase(auth), actor = auth.user
      if (method !== 'GET' && !(collection === 'interviews' && method === 'PUT')) {
        const roles = method === 'DELETE' && collection !== 'interviews' ? ['admin', 'super_admin', 'hr'] : RECRUITMENT_ROLES
        if (!roles.includes(actor.role)) throw recruitmentError('Insufficient permissions', 403)
      }
      const id = detail ? recruitmentId((await context.params).id) : null
      if (method === 'GET' && !detail) return NextResponse.json({ success: true, ...await listRecruitment(database, collection, new URL(request.url).searchParams, actor) })
      if (method === 'GET') {
        const record = await database.get(collection, id)
        if (!record) throw recruitmentError('Record not found', 404)
        if (collection === 'interviews' && !canReadInterview(record, actor)) throw recruitmentError('Insufficient permissions', 403)
        const [data] = await populateRecruitment(database, collection, [record])
        if (collection === 'jobpostings') {
          const counts = await Promise.all(STAGES.map(stage => database.count('candidates', [eq('jobPosting', id), eq('stage', stage)])))
          data.pipeline = Object.fromEntries(STAGES.map((stage, index) => [stage, counts[index]]))
          data.candidateCount = counts.reduce((sum, count) => sum + count, 0)
          data.recentCandidates = (await database.list('candidates', { filters: [eq('jobPosting', id)], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 10 })).records.map(row => Object.fromEntries(['_id', 'firstName', 'lastName', 'email', 'stage', 'rating', 'source', 'createdAt'].map(key => [key, row[key]])))
        }
        if (collection === 'candidates') {
          const interviews = await collectFirestorePages(database, 'interviews', { filters: [eq('candidate', id)], orderBy: [{ field: 'scheduledDate' }] }, 1000)
          data.interviews = await populateRecruitment(database, 'interviews', interviews.filter(row => canReadInterview(row, actor)))
        }
        return NextResponse.json({ success: true, data })
      }
      if (method === 'DELETE') {
        await deleteRecruitmentRecord(database, collection, id)
        return NextResponse.json({ success: true, message: 'Deleted successfully' })
      }
      const input = await request.json()
      let record
      if (collection === 'jobpostings') record = await saveJob(database, input, actor, id)
      else if (collection === 'interviews') record = await saveInterview(database, input, actor, id)
      else {
        const result = await saveCandidate(database, input, actor, id)
        if (result.existed || result.crossJobDuplicate) return NextResponse.json({ success: false, message: result.existed ? 'This candidate has already applied for this position' : 'A candidate with this email already exists for another job posting', ...result }, { status: 409 })
        record = result.candidate
      }
      const [data] = await populateRecruitment(database, collection, [record])
      return NextResponse.json({ success: true, message: id ? 'Updated successfully' : 'Created successfully', data }, { status: id ? 200 : 201 })
    } catch (error) {
      console.error('[Recruitment]', error.message)
      return NextResponse.json({ success: false, message: error.message || 'Recruitment request failed' }, { status: error.status || 500 })
    }
  }
}
