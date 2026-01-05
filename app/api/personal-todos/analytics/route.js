import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * Todo Analytics API
 * GET - Get analytics data for user's todos
 */

export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['PersonalTodo'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { searchParams } = new URL(request.url)
    
    // Date range parameters
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const period = searchParams.get('period') || 'month' // week, month, year, all

    // Calculate date range based on period
    let dateFilter = {}
    const now = new Date()
    
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    } else {
      switch (period) {
        case 'week':
          dateFilter.createdAt = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
          break
        case 'month':
          dateFilter.createdAt = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
          break
        case 'year':
          dateFilter.createdAt = { $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) }
          break
        // 'all' - no date filter
      }
    }

    const baseQuery = { user: user.userId, isDeleted: false, ...dateFilter }

    // Get basic counts
    const [
      totalTodos,
      completedTodos,
      pendingTodos,
      inProgressTodos,
      highPriorityTodos,
      overdueTodos
    ] = await Promise.all([
      models.PersonalTodo.countDocuments(baseQuery),
      models.PersonalTodo.countDocuments({ ...baseQuery, status: 'completed' }),
      models.PersonalTodo.countDocuments({ ...baseQuery, status: 'pending' }),
      models.PersonalTodo.countDocuments({ ...baseQuery, status: 'in_progress' }),
      models.PersonalTodo.countDocuments({ ...baseQuery, priority: 'high', status: { $ne: 'completed' } }),
      models.PersonalTodo.countDocuments({
        ...baseQuery,
        status: { $ne: 'completed' },
        dueDate: { $lt: new Date() }
      })
    ])

    // Get aggregated analytics data
    const analyticsAggregation = await models.PersonalTodo.aggregate([
      { $match: { ...baseQuery, status: 'completed' } },
      {
        $group: {
          _id: null,
          avgCompletionTime: { $avg: '$analytics.completionTime' },
          totalOnTime: { $sum: { $cond: ['$analytics.completedOnTime', 1, 0] } },
          totalLate: { $sum: { $cond: [{ $eq: ['$analytics.completedOnTime', false] }, 1, 0] } },
          avgDaysOverdue: { $avg: '$analytics.daysOverdue' },
          totalExtensions: { $sum: '$analytics.dueDateExtensions' }
        }
      }
    ])

    const analytics = analyticsAggregation[0] || {
      avgCompletionTime: 0,
      totalOnTime: 0,
      totalLate: 0,
      avgDaysOverdue: 0,
      totalExtensions: 0
    }

    // Get completion trend (last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const completionTrend = await models.PersonalTodo.aggregate([
      {
        $match: {
          user: user.userId,
          isDeleted: false,
          status: 'completed',
          completedAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$completedAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])

    // Get todos by category
    const todosByCategory = await models.PersonalTodo.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: '$category',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
        }
      },
      {
        $lookup: {
          from: 'todocategories',
          localField: '_id',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      {
        $project: {
          categoryId: '$_id',
          categoryName: { $arrayElemAt: ['$categoryInfo.name', 0] },
          categoryColor: { $arrayElemAt: ['$categoryInfo.color', 0] },
          total: 1,
          completed: 1,
          completionRate: {
            $multiply: [
              { $divide: ['$completed', { $max: ['$total', 1] }] },
              100
            ]
          }
        }
      }
    ])

    // Get todos by priority
    const todosByPriority = await models.PersonalTodo.aggregate([
      { $match: baseQuery },
      {
        $group: {
          _id: '$priority',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
        }
      }
    ])

    // Calculate productivity score (0-100)
    // Score should be 0 if no todos exist
    const completionRate = totalTodos > 0 ? (completedTodos / totalTodos) * 100 : 0
    const onTimeRate = analytics.totalOnTime + analytics.totalLate > 0
      ? (analytics.totalOnTime / (analytics.totalOnTime + analytics.totalLate)) * 100
      : 0 // Default to 0 instead of 100 when no data
    const productivityScore = totalTodos > 0 
      ? Math.round((completionRate * 0.6) + (onTimeRate * 0.4))
      : 0 // Explicitly 0 when no todos

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total: totalTodos,
          completed: completedTodos,
          pending: pendingTodos,
          inProgress: inProgressTodos,
          highPriority: highPriorityTodos,
          overdue: overdueTodos,
          completionRate: Math.round(completionRate * 100) / 100,
          productivityScore
        },
        analytics: {
          avgCompletionTimeHours: Math.round(analytics.avgCompletionTime * 100) / 100,
          onTimeCompletions: analytics.totalOnTime,
          lateCompletions: analytics.totalLate,
          onTimeRate: Math.round(onTimeRate * 100) / 100,
          avgDaysOverdue: Math.round(analytics.avgDaysOverdue * 100) / 100,
          totalDueDateExtensions: analytics.totalExtensions
        },
        trends: {
          completionTrend: completionTrend.map(t => ({
            date: t._id,
            count: t.count
          }))
        },
        breakdown: {
          byCategory: todosByCategory,
          byPriority: todosByPriority.reduce((acc, p) => {
            acc[p._id || 'none'] = { total: p.total, completed: p.completed }
            return acc
          }, {})
        },
        period,
        dateRange: {
          start: dateFilter.createdAt?.$gte || null,
          end: dateFilter.createdAt?.$lte || now
        }
      }
    })

  } catch (error) {
    console.error('Error fetching todo analytics:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}
