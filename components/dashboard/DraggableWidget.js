'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FaGripVertical, FaTimes } from 'react-icons/fa'
import { useState, useEffect } from 'react'

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
  const [isVisible, setIsVisible] = useState(false)

  // Trigger entrance animation on mount with staggered delay based on index
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, colorIndex * 80) // Stagger by 80ms per widget
    return () => clearTimeout(timer)
  }, [colorIndex])

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
    // No transition during drag for instant movement, smooth transition after drop
    transition: isDragging ? 'none' : (transition || 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'),
    zIndex: isDragging ? 50 : 'auto',
  }

  // Separate entrance animation classes from drag classes
  const entranceClasses = isVisible 
    ? 'opacity-100 translate-y-0 scale-100' 
    : 'opacity-0 translate-y-4 scale-[0.97]'

  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={`
        relative group bg-white border border-gray-100/50 h-full
        ${isDragging ? '' : 'transition-all duration-500 ease-out'}
        ${entranceClasses}
        ${isDragging ? 'ring-2 ring-primary-500 shadow-2xl' : 'shadow-sm hover:shadow-xl hover:scale-[1.01]'}
        ${className}
      `}
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
