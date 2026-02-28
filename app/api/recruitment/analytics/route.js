import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET - Recruitment analytics & dashboard stats
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['JobPosting', 'Candidate', 'Interview', 'Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { JobPosting, Candidate, Interview } = models

    const { searchParams } = new URL(request.url)
    const departmentFilter = searchParams.get('department')

    const jobQuery = {}
    if (departmentFilter) jobQuery.department = departmentFilter

    // Parallel aggregation queries for all stats
    const [
      jobStatusCounts,
      totalJobs,
      candidateStageCounts,
      totalCandidates,
      sourceBreakdown,
      interviewStatusCounts,
      totalInterviews,
      offerStats,
      recentJobs,
      hiringByDepartment,
      timeToHireData,
    ] = await Promise.all([
      // Job status breakdown
      JobPosting.aggregate([
        { $match: jobQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      JobPosting.countDocuments(jobQuery),

      // Candidate stage breakdown
      Candidate.aggregate([
        ...(departmentFilter ? [
          { $lookup: { from: 'jobpostings', localField: 'jobPosting', foreignField: '_id', as: 'job' } },
          { $unwind: '$job' },
          { $match: { 'job.department': departmentFilter } },
        ] : []),
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]),
      Candidate.countDocuments(),

      // Source breakdown
      Candidate.aggregate([
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Interview status breakdown
      Interview.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Interview.countDocuments(),

      // Offer stats
      Candidate.aggregate([
        { $match: { 'offer.status': { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$offer.status',
            count: { $sum: 1 },
          }
        },
      ]),

      // Recent job postings
      JobPosting.find(jobQuery)
        .populate('department', 'name')
        .sort({ createdAt: -1 })
        .limit(5)
        .select('jobTitle status department candidateCount createdAt')
        .lean(),

      // Hiring by department
      Candidate.aggregate([
        { $match: { stage: 'hired' } },
        { $lookup: { from: 'jobpostings', localField: 'jobPosting', foreignField: '_id', as: 'job' } },
        { $unwind: '$job' },
        { $lookup: { from: 'departments', localField: 'job.department', foreignField: '_id', as: 'dept' } },
        { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$dept.name', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Time-to-hire calculation (avg days from created → hired)
      Candidate.aggregate([
        { $match: { stage: 'hired' } },
        {
          $project: {
            daysToHire: {
              $divide: [
                { $subtract: ['$updatedAt', '$createdAt'] },
                1000 * 60 * 60 * 24,
              ],
            },
          }
        },
        {
          $group: {
            _id: null,
            avgDays: { $avg: '$daysToHire' },
            minDays: { $min: '$daysToHire' },
            maxDays: { $max: '$daysToHire' },
          }
        },
      ]),
    ])

    // Calculate conversion rates
    const hiredCount = candidateStageCounts.find(s => s._id === 'hired')?.count || 0
    const offerCount = candidateStageCounts.find(s => s._id === 'offer')?.count || 0
    const conversionRate = totalCandidates > 0 ? ((hiredCount / totalCandidates) * 100).toFixed(1) : 0
    const offerAccepted = offerStats.find(s => s._id === 'accepted')?.count || 0
    const totalOffers = offerStats.reduce((sum, s) => sum + s.count, 0)
    const offerAcceptanceRate = totalOffers > 0 ? ((offerAccepted / totalOffers) * 100).toFixed(1) : 0

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          totalJobs,
          openJobs: jobStatusCounts.find(s => s._id === 'open')?.count || 0,
          closedJobs: jobStatusCounts.find(s => s._id === 'closed')?.count || 0,
          draftJobs: jobStatusCounts.find(s => s._id === 'draft')?.count || 0,
          totalCandidates,
          totalInterviews,
          hiredCount,
          conversionRate: parseFloat(conversionRate),
          offerAcceptanceRate: parseFloat(offerAcceptanceRate),
          avgTimeToHire: timeToHireData[0]?.avgDays ? Math.round(timeToHireData[0].avgDays) : null,
        },
        pipeline: Object.fromEntries(candidateStageCounts.map(s => [s._id, s.count])),
        sourceBreakdown: Object.fromEntries(sourceBreakdown.map(s => [s._id || 'unknown', s.count])),
        jobStatusBreakdown: Object.fromEntries(jobStatusCounts.map(s => [s._id, s.count])),
        interviewStatusBreakdown: Object.fromEntries(interviewStatusCounts.map(s => [s._id, s.count])),
        hiringByDepartment: Object.fromEntries(hiringByDepartment.map(d => [d._id || 'Unassigned', d.count])),
        offerStats: Object.fromEntries(offerStats.map(s => [s._id, s.count])),
        recentJobs,
      },
    })
  } catch (error) {
    console.error('Get recruitment analytics error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch recruitment analytics' },
      { status: 500 }
    )
  }
}
