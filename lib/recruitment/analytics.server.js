import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { CANDIDATE_SOURCE_VALUES } from '@/lib/recruitmentConstants'
import { JOB_STATUSES, STAGES, INTERVIEW_STATUSES, eq, populateRecruitment } from './store.server'

export async function recruitmentAnalytics(database, department) {
  const jobFilters = department ? [eq('department', department)] : []
  const jobs = department ? await collectFirestorePages(database, 'jobpostings', { filters: jobFilters }) : null
  // Each query can add a category/status equality to the job membership filter.
  const chunks = jobs ? Array.from({ length: Math.ceil(jobs.length / 25) }, (_, i) => jobs.slice(i * 25, i * 25 + 25).map(row => row._id)) : null
  const scopedCount = async (collection, filters = []) => {
    if (!chunks) return database.count(collection, filters)
    return (await Promise.all(chunks.map(ids => database.count(collection, [...filters, eq('jobPosting', ids, 'in')])))).reduce((a, b) => a + b, 0)
  }
  const counts = async (collection, field, values, counter) => Object.fromEntries(await Promise.all(values.map(async value => [value, await counter(collection, [eq(field, value)])])))
  const [jobStatusBreakdown, pipeline, sourceBreakdown, interviewStatusBreakdown, offerStats, totalJobs, totalCandidates, totalInterviews, recent] = await Promise.all([
    counts('jobpostings', 'status', JOB_STATUSES, (collection, filters) => database.count(collection, [...jobFilters, ...filters])),
    counts('candidates', 'stage', STAGES, scopedCount), counts('candidates', 'source', CANDIDATE_SOURCE_VALUES, scopedCount),
    counts('interviews', 'status', INTERVIEW_STATUSES, scopedCount), counts('candidates', 'offer.status', ['pending', 'accepted', 'rejected', 'withdrawn', 'negotiating'], scopedCount),
    database.count('jobpostings', jobFilters), scopedCount('candidates'), scopedCount('interviews'),
    database.list('jobpostings', { filters: jobFilters, orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 5 }),
  ])
  // Only hired candidates are read for the cross-collection department and
  // duration calculation; all categorical aggregates above are native counts.
  const hired = chunks ? (await Promise.all(chunks.map(ids => collectFirestorePages(database, 'candidates', { filters: [eq('stage', 'hired'), eq('jobPosting', ids, 'in')] })))).flat() : await collectFirestorePages(database, 'candidates', { filters: [eq('stage', 'hired')] })
  const hiredJobs = await readFirestoreReferences(database, 'jobpostings', hired.map(row => row.jobPosting))
  const departments = await readFirestoreReferences(database, 'departments', [...hiredJobs.values()].map(row => row.department))
  const hiringByDepartment = {}, durations = []
  for (const row of hired) {
    const name = departments.get(String(hiredJobs.get(String(row.jobPosting))?.department))?.name || 'Unassigned'
    hiringByDepartment[name] = (hiringByDepartment[name] || 0) + 1
    const duration = (new Date(row.updatedAt) - new Date(row.createdAt)) / 86400000
    if (Number.isFinite(duration) && duration >= 0) durations.push(duration)
  }
  const totalOffers = Object.values(offerStats).reduce((a, b) => a + b, 0)
  return {
    overview: { totalJobs, openJobs: jobStatusBreakdown.open, closedJobs: jobStatusBreakdown.closed, draftJobs: jobStatusBreakdown.draft, totalCandidates, totalInterviews, hiredCount: pipeline.hired, conversionRate: totalCandidates ? Number((pipeline.hired * 100 / totalCandidates).toFixed(1)) : 0, offerAcceptanceRate: totalOffers ? Number((offerStats.accepted * 100 / totalOffers).toFixed(1)) : 0, avgTimeToHire: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null },
    pipeline, sourceBreakdown, jobStatusBreakdown, interviewStatusBreakdown, hiringByDepartment, offerStats,
    recentJobs: await populateRecruitment(database, 'jobpostings', recent.records),
  }
}
