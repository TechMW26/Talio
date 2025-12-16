'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FaGripVertical, FaTimes } from 'react-icons/fa'
import { useState } from 'react'

// Widget color palette - elegant gradient borders
const WIDGET_COLORS = [
  { border: 'border-l-4 border-l-blue-500', shadow: 'shadow-blue-100' },
  { border: 'border-l-4 border-l-emerald-500', shadow: 'shadow-emerald-100' },
  { border: 'border-l-4 border-l-violet-500', shadow: 'shadow-violet-100' },
  { border: 'border-l-4 border-l-amber-500', shadow: 'shadow-amber-100' },
  { border: 'border-l-4 border-l-rose-500', shadow: 'shadow-rose-100' },
  { border: 'border-l-4 border-l-cyan-500', shadow: 'shadow-cyan-100' },
  { border: 'border-l-4 border-l-indigo-500', shadow: 'shadow-indigo-100' },
  { border: 'border-l-4 border-l-teal-500', shadow: 'shadow-teal-100' },
  { border: 'border-l-4 border-l-orange-500', shadow: 'shadow-orange-100' },
  { border: 'border-l-4 border-l-pink-500', shadow: 'shadow-pink-100' },
]

export default function DraggableWidget({
  id,
  title,
  children,
  onRemove,
  className = '',
  colorIndex = 0,
  removable = true,
}) {
  const [showControls, setShowControls] = useState(false)
  
  // Get color based on index (cycles through colors)
  const color = WIDGET_COLORS[colorIndex % WIDGET_COLORS.length]

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    opacity: isDragging ? 0.8 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`relative group bg-white ${color.border} border border-gray-100 shadow-sm hover:shadow-md transition-shadow h-full ${isDragging ? 'ring-2 ring-primary-500 shadow-xl' : ''} ${className}`}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      
      {/* Widget Controls - appears on hover */}
      <div
        className={`absolute top-3 right-2 flex items-center gap-1 z-10 transition-opacity duration-200 ${showControls || isDragging ? 'opacity-100' : 'opacity-0'
          }`}
      >
        {/* Remove Button */}
        {removable && onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(id)
            }}
            className="p-1.5 rounded-md bg-red-100 hover:bg-red-200 transition-colors"
            title="Remove widget"
          >
            <FaTimes className="w-3 h-3 text-red-500" />
          </button>
        )}

        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="p-1.5 rounded-md bg-white/80 hover:bg-gray-100 cursor-grab active:cursor-grabbing transition-colors shadow-sm"
          title="Drag to reorder"
        >
          <FaGripVertical className="w-3 h-3 text-gray-500" />
        </div>
      </div>

      {/* Widget Content */}
      <div className="h-full">
        {children}
      </div>
    </div>
  )
}
