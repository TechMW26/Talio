'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FaGripVertical, FaTimes } from 'react-icons/fa'

export default function DraggableWidget({
  id,
  title,
  children,
  onRemove,
  className = '',
  colorIndex = 0,
  removable = true,
}) {
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
    // Track only the transform after a drop. `transition: all` forces every
    // widget to watch unrelated style changes during dashboard updates.
    transition: isDragging ? 'none' : (transition || 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)'),
    zIndex: isDragging ? 50 : 'auto',
    '--widget-enter-delay': `${Math.min(colorIndex, 10) * 45}ms`,
  }

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`
        dashboard-widget-enter relative group bg-white dark:bg-[#18181b] border border-gray-100/50 dark:border-zinc-800/50 h-full rounded-2xl
        ${isDragging ? '' : 'transition-[box-shadow,border-color] duration-300 ease-out'}
        ${isDragging ? 'ring-2 ring-primary-500 shadow-2xl' : 'shadow-sm dark:shadow-none hover:shadow-xl dark:hover:shadow-lg dark:hover:shadow-black/20 hover:scale-[1.01]'}
        ${className}
      `}
    >
      
      {/* Widget Controls - appears on hover */}
      <div
        className={`absolute top-3 right-2 flex items-center gap-1 z-10 transition-opacity duration-200 ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
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
          className="p-1.5 rounded-md bg-white/80 dark:bg-white/10 hover:bg-gray-100 dark:hover:bg-white/20 cursor-grab active:cursor-grabbing transition-colors shadow-sm"
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
