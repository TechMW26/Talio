'use client'

import ProjectTasksWidget from '@/components/dashboards/ProjectTasksWidget'

export default function ProjectTasksWidgetWrapper({ limit = 5, showPendingAcceptance = true }) {
  return (
  <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <ProjectTasksWidget limit={limit} showPendingAcceptance={showPendingAcceptance} />
    </div>
  )
}
