'use client'

import { useState, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import DraggableWidget from './DraggableWidget'
import AddWidgetModal from './AddWidgetModal'
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets'
import { WIDGET_REGISTRY } from '@/lib/widgetRegistry'
import { FaPlus, FaUndo, FaCog, FaTh, FaThLarge } from 'react-icons/fa'

// Layout storage key
const LAYOUT_STORAGE_KEY = 'dashboard_layout_columns'

export default function CustomizableDashboard({
  userId,
  userRole = 'employee',
  widgetComponents,  // Object mapping widget IDs to their rendered components
  className = 'space-y-5',
}) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [columnLayout, setColumnLayout] = useState(2) // Default to 2 columns for desktop
  const [isDesktop, setIsDesktop] = useState(false) // Track if on desktop for height matching

  // Check if on desktop (md breakpoint = 768px)
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 768)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Load saved column layout
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLayout = localStorage.getItem(`${LAYOUT_STORAGE_KEY}_${userId}`)
      if (savedLayout) {
        setColumnLayout(parseInt(savedLayout, 10))
      }
    }
  }, [userId])

  // Save column layout
  const toggleColumnLayout = () => {
    const newLayout = columnLayout === 1 ? 2 : 1
    setColumnLayout(newLayout)
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${LAYOUT_STORAGE_KEY}_${userId}`, newLayout.toString())
    }
  }

  const {
    enabledWidgets,
    widgetOrder,
    isInitialized,
    addWidget,
    removeWidget,
    handleDragEnd,
    resetToDefaults,
    getOrderedWidgets,
  } = useDashboardWidgets(userId, userRole)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEndWithReset = (event) => {
    handleDragEnd(event)
  }

  const handleAddWidget = (widget) => {
    addWidget(widget.id)
  }

  const handleRemoveWidget = (widgetId) => {
    removeWidget(widgetId)
  }

  // Loading skeleton
  if (!isInitialized) {
    return (
      <div className={className}>
        <div className="flex justify-end mb-4 gap-2">
          <div className="h-9 w-32 bg-gray-200 rounded-lg animate-pulse"></div>
          <div className="h-9 w-32 bg-gray-200 rounded-lg animate-pulse"></div>
        </div>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl p-6 animate-pulse"
            style={{ backgroundColor: 'var(--color-bg-card)', minHeight: '150px' }}
          >
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="h-24 bg-gray-200 rounded"></div>
          </div>
        ))}
      </div>
    )
  }

  // Get ordered widgets that have components
  const orderedWidgets = getOrderedWidgets().filter(
    widget => widgetComponents[widget.id]
  )

  return (
    <div className="relative">
      {/* Dashboard Controls - Hidden on mobile */}
      <div className="hidden md:flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isEditMode && (
            <span className="text-xs text-primary-600 bg-primary-50 px-2 py-1 rounded-full font-medium">
              Edit Mode
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Edit Mode Toggle */}
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${isEditMode
                ? 'bg-primary-500 text-white'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            title={isEditMode ? 'Exit edit mode' : 'Enter edit mode to customize'}
          >
            <FaCog className="w-3 h-3" />
            <span>{isEditMode ? 'Done Editing' : 'Customize'}</span>
          </button>

          {/* Reset Button */}
          <button
            onClick={resetToDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Reset to default layout"
          >
            <FaUndo className="w-3 h-3" />
            <span>Reset</span>
          </button>

          {/* Column Layout Toggle - Desktop Only */}
          <div className="hidden md:flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => columnLayout !== 1 && toggleColumnLayout()}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                columnLayout === 1
                  ? 'bg-primary-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
              title="Single column layout"
            >
              <FaTh className="w-3 h-3" />
              <span>1 Col</span>
            </button>
            <button
              onClick={() => columnLayout !== 2 && toggleColumnLayout()}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                columnLayout === 2
                  ? 'bg-primary-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
              title="Two column layout"
            >
              <FaThLarge className="w-3 h-3" />
              <span>2 Col</span>
            </button>
          </div>

          {/* Add Widget Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white text-sm font-medium rounded-lg hover:bg-primary-600 transition-colors shadow-sm"
          >
            <FaPlus className="w-3.5 h-3.5" />
            <span>Add Widget</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      {orderedWidgets.length === 0 && (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ backgroundColor: 'var(--color-bg-card)' }}
        >
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
            <FaPlus className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            Your dashboard is empty
          </h3>
          <p className="text-gray-500 mb-4 max-w-md mx-auto">
            Start customizing your dashboard by adding widgets. Choose from attendance, employees, leave management, and more!
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-2.5 bg-primary-500 text-white font-medium rounded-lg hover:bg-primary-600 transition-colors"
          >
            Add Your First Widget
          </button>
        </div>
      )}

      {/* Draggable Widgets Grid */}
      {orderedWidgets.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEndWithReset}
        >
          <SortableContext
            items={orderedWidgets.map(w => w.id)}
            strategy={rectSortingStrategy}
          >
            <div className={`${columnLayout === 2 ? 'grid md:grid-cols-2 gap-5' : className}`} style={columnLayout === 2 && isDesktop ? { gridAutoRows: '1fr' } : {}}>
              {orderedWidgets.map((widget, index) => {
                const WidgetContent = widgetComponents[widget.id]

                return (
                  <DraggableWidget
                    key={widget.id}
                    id={widget.id}
                    title={widget.name}
                    colorIndex={index}
                    onRemove={isEditMode ? handleRemoveWidget : null}
                    removable={isEditMode}
                    className="rounded-[30px] overflow-hidden"
                  >
                    {WidgetContent}
                  </DraggableWidget>
                )
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add Widget Modal */}
      <AddWidgetModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAddWidget={handleAddWidget}
        enabledWidgets={enabledWidgets}
        userRole={userRole}
      />
    </div>
  )
}
