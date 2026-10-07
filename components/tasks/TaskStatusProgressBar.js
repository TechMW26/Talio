'use client'
import { getStatusColorClasses } from '@/lib/taskStatusConfig'

export default function TaskStatusProgressBar({ tasks = [], taskStatuses = [] }) {
  const total = tasks.length
  if (total === 0 || taskStatuses.length === 0) return null
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const completedPercent = Math.round((completedCount / total) * 100)
  const segments = taskStatuses.map(s => ({ ...s, count: tasks.filter(t => t.status === s.key).length, colors: getStatusColorClasses(s.color) })).filter(s => s.count > 0)

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-500">Task progress</span>
        <span className="text-xs font-semibold text-gray-700">{completedPercent}% completed · {total} task{total === 1 ? '' : 's'}</span>
      </div>
      <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-gray-100">
        {segments.map(s => <div key={s.key} title={`${s.label}: ${s.count}`} className={`${s.colors.dot} h-full transition-all duration-300`} style={{ width: `${(s.count / total) * 100}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {segments.map(s => (
          <span key={s.key} className="flex items-center gap-1 text-[11px] text-gray-500">
            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${s.colors.dot}`} /> {s.label} ({s.count})
          </span>
        ))}
      </div>
    </div>
  )
}