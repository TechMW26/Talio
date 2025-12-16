'use client'

import { useMemo } from 'react'
import { format } from 'date-fns'
import { 
  FaCodeBranch, FaCheckCircle, FaPlus, FaEdit, FaComment, 
  FaUserPlus, FaUserMinus, FaExchangeAlt, FaTrash, FaFlag,
  FaFile, FaTasks
} from 'react-icons/fa'

const BRANCH_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
]

const getEventIcon = (type) => {
  switch (type) {
    case 'task_created': return <FaPlus size={10} />
    case 'task_completed': return <FaCheckCircle size={10} />
    case 'task_updated': 
    case 'task_status_changed': return <FaEdit size={10} />
    case 'comment_added': return <FaComment size={10} />
    case 'member_invited':
    case 'member_accepted': return <FaUserPlus size={10} />
    case 'member_removed':
    case 'member_rejected': return <FaUserMinus size={10} />
    case 'task_assigned': return <FaExchangeAlt size={10} />
    case 'task_deleted': return <FaTrash size={10} />
    case 'project_created': return <FaFlag size={10} />
    default: return <FaCodeBranch size={10} />
  }
}

export default function ProjectActivityGraph({ events }) {
  // Process events to determine branches and layout
  const { processedEvents, branches } = useMemo(() => {
    const uniqueTasks = new Set()
    const taskMap = new Map() // taskId -> { id, name, colorIndex }
    
    // Identify all tasks involved
    events.forEach(event => {
      if (event.relatedTask) {
        const taskId = typeof event.relatedTask === 'object' ? event.relatedTask._id : event.relatedTask
        if (!uniqueTasks.has(taskId)) {
          uniqueTasks.add(taskId)
          // Try to get task title from metadata if available, or use ID
          const taskTitle = event.metadata?.taskTitle || event.relatedTask.title || 'Task'
          taskMap.set(taskId, {
            id: taskId,
            name: taskTitle,
            colorIndex: (uniqueTasks.size - 1) % BRANCH_COLORS.length
          })
        }
      }
    })

    const branches = [
      { id: 'main', name: 'Project', color: '#64748b' }, // Main branch (slate-500)
      ...Array.from(taskMap.values()).map(t => ({
        id: t.id,
        name: t.name,
        color: BRANCH_COLORS[t.colorIndex]
      }))
    ]

    const branchIndexMap = new Map(branches.map((b, i) => [b.id, i]))

    const processed = events.map(event => {
      const taskId = event.relatedTask ? (typeof event.relatedTask === 'object' ? event.relatedTask._id : event.relatedTask) : 'main'
      const branchIndex = branchIndexMap.get(taskId) ?? 0
      
      return {
        ...event,
        branchIndex,
        branchColor: branches[branchIndex].color
      }
    })

    return { processedEvents: processed, branches }
  }, [events])

  return (
    <div className="font-sans">
      <div className="flex gap-4 mb-4 overflow-x-auto pb-2">
        {branches.map((branch, i) => (
          <div key={branch.id} className="flex items-center gap-2 text-xs whitespace-nowrap">
            <span 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: branch.color }}
            />
            <span className="text-gray-600 font-medium">{branch.name}</span>
          </div>
        ))}
      </div>

      <div className="relative">
        {processedEvents.map((event, index) => (
          <div key={event._id} className="flex group">
            {/* Graph Section */}
            <div className="flex-shrink-0 w-auto min-w-[60px] flex relative select-none" style={{ width: `${branches.length * 20 + 20}px` }}>
              {/* Render vertical lines for all branches */}
              {branches.map((branch, i) => (
                <div 
                  key={branch.id}
                  className="absolute top-0 bottom-0 w-0.5 transition-colors"
                  style={{ 
                    left: `${i * 20 + 20}px`,
                    backgroundColor: branch.color,
                    opacity: 0.3
                  }}
                />
              ))}

              {/* Render the dot for the current event */}
              <div 
                className="absolute top-6 w-3 h-3 rounded-full border-2 border-white shadow-sm z-10 flex items-center justify-center"
                style={{ 
                  left: `${event.branchIndex * 20 + 20 - 5}px`, // -5 to center the 12px dot on the line
                  backgroundColor: event.branchColor
                }}
              >
              </div>
              
              {/* Horizontal connector if needed (optional, for visual flair) */}
              {/* <div 
                className="absolute top-6 h-0.5 bg-gray-200"
                style={{
                  left: `${event.branchIndex * 20 + 20}px`,
                  width: '20px'
                }}
              /> */}
            </div>

            {/* Content Section */}
            <div className="flex-1 pb-8 pt-2 pl-2">
              <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative">
                {/* Colored accent bar on left */}
                <div 
                  className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full"
                  style={{ backgroundColor: event.branchColor }}
                />
                
                <div className="flex items-start gap-3 pl-2">
                  <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center flex-shrink-0 border border-gray-100">
                    {event.createdBy?.profilePicture ? (
                      <img src={event.createdBy.profilePicture} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-gray-500">
                        {event.createdBy?.firstName?.[0]}{event.createdBy?.lastName?.[0]}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">
                          {event.createdBy?.firstName} {event.createdBy?.lastName}
                        </span>
                        <span className="text-xs text-gray-400">
                          {format(new Date(event.createdAt), 'MMM d, h:mm a')}
                        </span>
                      </div>
                      <div 
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider"
                        style={{ 
                          backgroundColor: `${event.branchColor}15`, // 10% opacity
                          color: event.branchColor 
                        }}
                      >
                        {getEventIcon(event.type)}
                        <span>{event.type.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                    
                    <p className="text-gray-600 text-sm leading-relaxed">
                      {event.description}
                    </p>

                    {/* Metadata rendering */}
                    {event.metadata?.rejectionReason && (
                      <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700">
                        <strong>Reason:</strong> {event.metadata.rejectionReason}
                      </div>
                    )}
                    
                    {event.commentContent && (
                      <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-700 italic border-l-2 border-gray-300">
                        "{event.commentContent}"
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
