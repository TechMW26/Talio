'use client'

import { useState } from 'react'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable'
import DraggableKPICard from './DraggableKPICard'
import { useDashboardLayout } from '@/hooks/useDashboardLayout'
import { FaUndo } from 'react-icons/fa'

export default function DraggableKPIGrid({
    stats,
    userId,
    onCardClick,
    showResetButton = true,
    showTrend = false,
    gridClassName = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
}) {
    const [activeId, setActiveId] = useState(null)

    const {
        orderedStats,
        handleDragEnd,
        resetOrder,
        isInitialized
    } = useDashboardLayout(stats, userId)

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // Require 8px movement before drag starts (prevents accidental drags)
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const handleDragStart = (event) => {
        setActiveId(event.active.id)
    }

    const handleDragEndWithReset = (event) => {
        handleDragEnd(event)
        setActiveId(null)
    }

    const handleDragCancel = () => {
        setActiveId(null)
    }

    // Get the active stat for overlay
    const activeStat = activeId
        ? orderedStats.find(stat => stat.title === activeId)
        : null

    if (!isInitialized) {
        // Show skeleton loading state
        return (
            <div className={gridClassName}>
                {stats.map((_, index) => (
                    <div
                        key={index}
                        className="rounded-lg shadow-md p-3 sm:p-6 animate-pulse"
                        style={{ backgroundColor: 'var(--color-bg-card)' }}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <div className="h-4 bg-gray-200 dark:bg-zinc-600 rounded w-24 mb-2"></div>
                                <div className="h-8 bg-gray-200 dark:bg-zinc-600 rounded w-16"></div>
                            </div>
                            <div className="w-12 h-12 bg-gray-200 dark:bg-zinc-600 rounded-lg"></div>
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="relative">
            {/* Reset Button */}
            {showResetButton && (
                <div className="flex justify-end mb-3">
                    <button
                        onClick={resetOrder}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Reset card order to default"
                    >
                        <FaUndo className="w-3 h-3" />
                        <span>Reset Layout</span>
                    </button>
                </div>
            )}

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEndWithReset}
                onDragCancel={handleDragCancel}
            >
                <SortableContext
                    items={orderedStats.map(stat => stat.title)}
                    strategy={rectSortingStrategy}
                >
                    <div className={gridClassName}>
                        {orderedStats.map((stat) => (
                            <DraggableKPICard
                                key={stat.title}
                                id={stat.title}
                                stat={stat}
                                onClick={() => onCardClick?.(stat)}
                                showTrend={showTrend}
                            />
                        ))}
                    </div>
                </SortableContext>

                {/* Drag Overlay - Shows the card being dragged */}
                <DragOverlay adjustScale={true}>
                    {activeStat ? (
                        <div
                            className="rounded-lg shadow-2xl p-3 sm:p-6 ring-2 ring-primary-500 opacity-90"
                            style={{ backgroundColor: 'var(--color-bg-card)' }}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                    <p className="text-gray-500 text-xs sm:text-sm font-medium truncate">{activeStat.title}</p>
                                    <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mt-1 sm:mt-2 truncate">{activeStat.value}</h3>
                                </div>
                                <div className={`${activeStat.color} p-2 sm:p-4 rounded-lg flex-shrink-0`}>
                                    <activeStat.icon className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                                </div>
                            </div>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
        </div>
    )
}
