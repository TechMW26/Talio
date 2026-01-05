'use client'

import {
  HiOutlineXMark,
  HiOutlineChartBar,
  HiOutlineTrophy,
  HiOutlineArrowTrendingUp,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlineCalendarDays
} from 'react-icons/hi2'

export default function AnalyticsPanel({ analytics, onClose }) {
  if (!analytics) return null

  const { summary, trends, breakdown } = analytics

  // Get completion trend data for the chart
  const trendData = trends?.completionTrend || []
  const maxCount = Math.max(...trendData.map(t => t.count), 1)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <HiOutlineChartBar className="w-5 h-5 text-indigo-600" />
          To-do Analytics
        </h2>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <HiOutlineXMark className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Productivity Score */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <HiOutlineTrophy className="w-6 h-6" />
            </div>
            <div>
              <p className="text-3xl font-bold">{summary?.productivityScore || 0}%</p>
              <p className="text-sm text-white/80">Productivity Score</p>
            </div>
          </div>
        </div>

        {/* Completion Rate */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineCheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {summary?.completionRate?.toFixed(0) || 0}%
              </p>
              <p className="text-sm text-gray-500">Completion Rate</p>
            </div>
          </div>
        </div>

        {/* On-time Rate */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlineClock className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {analytics?.analytics?.onTimeRate?.toFixed(0) || 0}%
              </p>
              <p className="text-sm text-gray-500">On-time Completions</p>
            </div>
          </div>
        </div>

        {/* Avg Completion Time */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <HiOutlineArrowTrendingUp className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {analytics?.analytics?.avgCompletionTimeHours?.toFixed(1) || 0}h
              </p>
              <p className="text-sm text-gray-500">Avg Completion Time</p>
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Trend Chart */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-600 mb-3">To-dos Completed (Last 7 Days)</h3>
        <div className="flex items-end gap-2 h-32">
          {trendData.length > 0 ? (
            trendData.map((day, index) => (
              <div key={day.date} className="flex-1 flex flex-col items-center">
                <div 
                  className="w-full bg-indigo-500 rounded-t transition-all hover:bg-indigo-600"
                  style={{ 
                    height: `${(day.count / maxCount) * 100}%`,
                    minHeight: day.count > 0 ? '4px' : '0'
                  }}
                  title={`${day.count} to-dos`}
                ></div>
                <span className="text-xs text-gray-500 mt-1">
                  {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                </span>
              </div>
            ))
          ) : (
            <div className="w-full flex items-center justify-center text-gray-400 text-sm">
              No completion data yet
            </div>
          )}
        </div>
      </div>

      {/* Breakdown by Priority */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-3">By Priority</h3>
          <div className="space-y-3">
            {['urgent', 'high', 'medium', 'low'].map(priority => {
              const data = breakdown?.byPriority?.[priority] || { total: 0, completed: 0 }
              const percentage = data.total > 0 ? (data.completed / data.total) * 100 : 0
              const colors = {
                urgent: 'bg-red-600',
                high: 'bg-red-500',
                medium: 'bg-amber-500',
                low: 'bg-green-500'
              }
              return (
                <div key={priority}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="capitalize text-gray-700">{priority}</span>
                    <span className="text-gray-500">{data.completed}/{data.total}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${colors[priority]} rounded-full transition-all`}
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Breakdown by Category */}
        {breakdown?.byCategory && breakdown.byCategory.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-3">By Category</h3>
            <div className="space-y-3">
              {breakdown.byCategory.slice(0, 5).map(cat => {
                const percentage = cat.total > 0 ? (cat.completed / cat.total) * 100 : 0
                return (
                  <div key={cat.categoryId || 'uncategorized'}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: cat.categoryColor || '#9ca3af' }}
                        ></div>
                        <span className="text-gray-700">{cat.categoryName || 'Uncategorized'}</span>
                      </span>
                      <span className="text-gray-500">{cat.completed}/{cat.total}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all"
                        style={{ 
                          width: `${percentage}%`,
                          backgroundColor: cat.categoryColor || '#9ca3af'
                        }}
                      ></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">{analytics?.analytics?.onTimeCompletions || 0}</p>
          <p className="text-xs text-gray-500">On Time</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-red-600">{analytics?.analytics?.lateCompletions || 0}</p>
          <p className="text-xs text-gray-500">Completed Late</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-amber-600">{summary?.highPriority || 0}</p>
          <p className="text-xs text-gray-500">High Priority Pending</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-600">{analytics?.analytics?.totalDueDateExtensions || 0}</p>
          <p className="text-xs text-gray-500">Due Date Extensions</p>
        </div>
      </div>
    </div>
  )
}
