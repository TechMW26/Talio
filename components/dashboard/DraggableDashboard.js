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
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import DraggableDashboardSection from './DraggableDashboardSection'
import { useDashboardSectionLayout } from '@/hooks/useDashboardSectionLayout'
import { FaUndo, FaGripVertical } from 'react-icons/fa'

export default function DraggableDashboard({
    sections,
    userId,
    className = "space-y-5 sm:space-y-8"
}) {
    const [activeId, setActiveId] = useState(null)

    const {
        orderedSections,
        handleDragEnd,
        resetOrder,
        isInitialized
    } = useDashboardSectionLayout(sections, userId)

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 10, // Require 10px movement before drag starts
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

    // Get the active section for overlay
    const activeSection = activeId
        ? orderedSections.find(section => section.id === activeId)
        : null

    if (!isInitialized) {
        // Show skeleton loading state
        return (
            <div className={className}>
                {sections.map((section, index) => (
                    <div
                        key={index}
                        className="rounded-2xl p-6 animate-pulse"
                        style={{ backgroundColor: 'var(--color-bg-card)', minHeight: '150px' }}
                    >
                        <div className="h-6 bg-gray-200 dark:bg-zinc-600 rounded w-1/4 mb-4"></div>
                        <div className="h-24 bg-gray-200 dark:bg-zinc-600 rounded"></div>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="relative">
            {/* Reset Button */}
            <div className="flex justify-end mb-3">
                <button
                    onClick={resetOrder}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Reset dashboard layout to default"
                >
                    <FaUndo className="w-3 h-3" />
                    <span>Reset Layout</span>
                </button>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEndWithReset}
                onDragCancel={handleDragCancel}
            >
                <SortableContext
                    items={orderedSections.map(section => section.id)}
                    strategy={verticalListSortingStrategy}
                >
                    <div className={className}>
                        {orderedSections.map((section) => (
                            <DraggableDashboardSection
                                key={section.id}
                                id={section.id}
                                className={section.className || ''}
                                style={section.style || {}}
                            >
                                {section.component}
                            </DraggableDashboardSection>
                        ))}
                    </div>
                </SortableContext>

                {/* Drag Overlay - Shows the section being dragged */}
                <DragOverlay adjustScale={false}>
                    {activeSection ? (
                        <div
                            className={`rounded-2xl shadow-2xl ring-2 ring-primary-500 opacity-95 ${activeSection.className || ''}`}
                            style={{
                                backgroundColor: 'var(--color-bg-card)',
                                ...activeSection.style,
                                maxHeight: '300px',
                                overflow: 'hidden'
                            }}
                        >
                            <div className="p-4 flex items-center gap-2 bg-primary-50 border-b border-primary-100">
                                <FaGripVertical className="w-4 h-4 text-primary-500" />
                                <span className="text-sm font-medium text-primary-700">
                                    {activeSection.title || 'Dashboard Section'}
                                </span>
                            </div>
                            <div className="p-4 opacity-50 blur-[1px]">
                                {activeSection.component}
                            </div>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
        </div>
    )
}
