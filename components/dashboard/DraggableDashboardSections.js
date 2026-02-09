'use client'

import { useState, useEffect, useCallback } from 'react'
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
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FiMove, FiSettings, FiEye, FiEyeOff, FiRotateCcw } from 'react-icons/fi'

// Sortable Section Item
function SortableSectionItem({ id, children, isEditMode, isHidden, onToggleVisibility }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, disabled: !isEditMode })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : isHidden ? 0.4 : 1,
    }

    if (isHidden && !isEditMode) {
        return null
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`relative ${isDragging ? 'z-50' : ''} ${isHidden ? 'grayscale' : ''}`}
        >
            {isEditMode && (
                <div className="absolute -top-2 -right-2 z-10 flex gap-1">
                    <button
                        {...attributes}
                        {...listeners}
                        className="p-2 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-600 cursor-grab active:cursor-grabbing hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        title="Drag to reorder"
                    >
                        <FiMove className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    </button>
                    <button
                        onClick={() => onToggleVisibility(id)}
                        className="p-2 bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        title={isHidden ? 'Show section' : 'Hide section'}
                    >
                        {isHidden ? (
                            <FiEyeOff className="w-4 h-4 text-gray-400" />
                        ) : (
                            <FiEye className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                        )}
                    </button>
                </div>
            )}
            {isEditMode && (
                <div className="absolute inset-0 border-2 border-dashed border-blue-400 dark:border-blue-500 rounded-2xl pointer-events-none" />
            )}
            {children}
        </div>
    )
}

// Main Draggable Dashboard Sections Component
export default function DraggableDashboardSections({
    sections,
    userId,
    storageKey = 'dashboard-sections',
}) {
    const [sectionOrder, setSectionOrder] = useState([])
    const [hiddenSections, setHiddenSections] = useState(new Set())
    const [isEditMode, setIsEditMode] = useState(false)
    const [activeId, setActiveId] = useState(null)
    const [isLoaded, setIsLoaded] = useState(false)

    const fullStorageKey = `${storageKey}-${userId}`

    // Load saved order and visibility from localStorage
    useEffect(() => {
        const savedData = localStorage.getItem(fullStorageKey)
        if (savedData) {
            try {
                const { order, hidden } = JSON.parse(savedData)
                // Validate order contains all section ids
                const sectionIds = sections.map(s => s.id)
                const validOrder = order.filter(id => sectionIds.includes(id))
                // Add any new sections that weren't in saved order
                const newSections = sectionIds.filter(id => !validOrder.includes(id))
                setSectionOrder([...validOrder, ...newSections])
                setHiddenSections(new Set(hidden || []))
            } catch (e) {
                setSectionOrder(sections.map(s => s.id))
            }
        } else {
            setSectionOrder(sections.map(s => s.id))
        }
        setIsLoaded(true)
    }, [sections, fullStorageKey])

    // Save to localStorage when order or visibility changes
    useEffect(() => {
        if (isLoaded && sectionOrder.length > 0) {
            localStorage.setItem(fullStorageKey, JSON.stringify({
                order: sectionOrder,
                hidden: Array.from(hiddenSections)
            }))
        }
    }, [sectionOrder, hiddenSections, fullStorageKey, isLoaded])

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const handleDragStart = useCallback((event) => {
        setActiveId(event.active.id)
    }, [])

    const handleDragEnd = useCallback((event) => {
        const { active, over } = event

        if (over && active.id !== over.id) {
            setSectionOrder((items) => {
                const oldIndex = items.indexOf(active.id)
                const newIndex = items.indexOf(over.id)
                return arrayMove(items, oldIndex, newIndex)
            })
        }

        setActiveId(null)
    }, [])

    const handleToggleVisibility = useCallback((id) => {
        setHiddenSections(prev => {
            const newSet = new Set(prev)
            if (newSet.has(id)) {
                newSet.delete(id)
            } else {
                newSet.add(id)
            }
            return newSet
        })
    }, [])

    const handleReset = useCallback(() => {
        setSectionOrder(sections.map(s => s.id))
        setHiddenSections(new Set())
        localStorage.removeItem(fullStorageKey)
    }, [sections, fullStorageKey])

    // Create a map of sections by id for easy lookup
    const sectionsMap = new Map(sections.map(s => [s.id, s]))

    // Get the active section for drag overlay
    const activeSection = activeId ? sectionsMap.get(activeId) : null

    if (!isLoaded) {
        return (
            <div className="space-y-5 sm:space-y-8 animate-pulse">
                {sections.map((_, i) => (
                    <div key={i} className="h-48 bg-gray-200 dark:bg-slate-700 rounded-2xl" />
                ))}
            </div>
        )
    }

    return (
        <div className="relative">
            {/* Edit Mode Toggle */}
            <div className="flex justify-end mb-4 gap-2">
                {isEditMode && (
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
                    >
                        <FiRotateCcw className="w-4 h-4" />
                        Reset Layout
                    </button>
                )}
                <button
                    onClick={() => setIsEditMode(!isEditMode)}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors shadow-sm ${isEditMode
                            ? 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600'
                            : 'text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                >
                    <FiSettings className={`w-4 h-4 ${isEditMode ? 'animate-spin-slow' : ''}`} />
                    {isEditMode ? 'Done Editing' : 'Customize Layout'}
                </button>
            </div>

            {isEditMode && (
                <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                        <strong>Edit Mode:</strong> Drag sections to reorder them. Click the eye icon to show/hide sections.
                    </p>
                </div>
            )}

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={sectionOrder}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="space-y-5 sm:space-y-8">
                        {sectionOrder.map((id) => {
                            const section = sectionsMap.get(id)
                            if (!section) return null

                            return (
                                <SortableSectionItem
                                    key={id}
                                    id={id}
                                    isEditMode={isEditMode}
                                    isHidden={hiddenSections.has(id)}
                                    onToggleVisibility={handleToggleVisibility}
                                >
                                    {section.component}
                                </SortableSectionItem>
                            )
                        })}
                    </div>
                </SortableContext>

                <DragOverlay>
                    {activeSection ? (
                        <div className="opacity-80 scale-[1.02] shadow-2xl">
                            {activeSection.component}
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Hidden sections indicator */}
            {!isEditMode && hiddenSections.size > 0 && (
                <div className="mt-4 text-center">
                    <button
                        onClick={() => setIsEditMode(true)}
                        className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                        {hiddenSections.size} section{hiddenSections.size > 1 ? 's' : ''} hidden • Click to customize
                    </button>
                </div>
            )}
        </div>
    )
}

// Export a simpler hook for using draggable sections
export function useDraggableSections(sections, userId, storageKey = 'dashboard-sections') {
    const [orderedSections, setOrderedSections] = useState(sections)
    const fullStorageKey = `${storageKey}-${userId}`

    useEffect(() => {
        const savedData = localStorage.getItem(fullStorageKey)
        if (savedData) {
            try {
                const { order } = JSON.parse(savedData)
                const sectionIds = sections.map(s => s.id)
                const validOrder = order.filter(id => sectionIds.includes(id))
                const newSections = sectionIds.filter(id => !validOrder.includes(id))
                const finalOrder = [...validOrder, ...newSections]

                const reordered = finalOrder
                    .map(id => sections.find(s => s.id === id))
                    .filter(Boolean)

                setOrderedSections(reordered)
            } catch (e) {
                setOrderedSections(sections)
            }
        } else {
            setOrderedSections(sections)
        }
    }, [sections, fullStorageKey])

    return orderedSections
}
