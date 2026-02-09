'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FaGripVertical, FaArrowUp, FaArrowDown } from 'react-icons/fa'

export default function DraggableKPICard({
    id,
    stat,
    onClick,
    isDragging: externalDragging,
    showTrend = false
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        backgroundColor: 'var(--color-bg-card)',
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.8 : 1,
    }

    const Icon = stat.icon

    // Check if color is a CSS class or an inline style (hex color)
    const isInlineColor = stat.color?.startsWith('#') || stat.color?.startsWith('rgb')
    const iconContainerStyle = isInlineColor ? { backgroundColor: stat.color } : {}
    const iconContainerClass = isInlineColor ? '' : stat.color

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`rounded-lg shadow-md p-3 sm:p-6 hover:shadow-lg transition-shadow cursor-pointer relative group ${isDragging ? 'ring-2 ring-primary-500 shadow-xl' : ''
                }`}
            onClick={onClick}
        >
            {/* Drag Handle */}
            <div
                {...attributes}
                {...listeners}
                className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing hover:bg-gray-100 dark:hover:bg-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <FaGripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>

            <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                    <p className="text-gray-500 text-xs sm:text-sm font-medium truncate">{stat.title}</p>
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mt-1 sm:mt-2 truncate">{stat.value}</h3>

                    {/* Trend indicator - shown when showTrend is true and stat has trend/change */}
                    {showTrend && stat.change && (
                        <div className="flex items-center mt-1 sm:mt-2">
                            {stat.trend === 'up' ? (
                                <FaArrowUp className="w-3 h-3 sm:w-4 sm:h-4 text-green-500 mr-1 flex-shrink-0" />
                            ) : stat.trend === 'down' ? (
                                <FaArrowDown className="w-3 h-3 sm:w-4 sm:h-4 text-red-500 mr-1 flex-shrink-0" />
                            ) : null}
                            <span className={`text-xs sm:text-sm font-medium truncate ${stat.trend === 'up' ? 'text-green-500' :
                                    stat.trend === 'down' ? 'text-red-500' : 'text-gray-500'
                                }`}>
                                {stat.change}
                            </span>
                        </div>
                    )}
                </div>
                <div
                    className={`${iconContainerClass} p-2 sm:p-4 rounded-lg flex-shrink-0`}
                    style={iconContainerStyle}
                >
                    <Icon className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
            </div>
        </div>
    )
}
