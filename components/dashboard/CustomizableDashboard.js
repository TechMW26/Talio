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
import ActionableInsights from './ActionableInsights'
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets'
import { WIDGET_REGISTRY } from '@/lib/widgetRegistry'
import { FaPlus, FaUndo, FaCog, FaTh, FaThLarge } from 'react-icons/fa'

// Layout storage key
const LAYOUT_STORAGE_KEY = 'dashboard_layout_columns'

export default function CustomizableDashboard({
  userId,
  userRole = 'employee',
  displayName = '',
  widgetComponents,  // Object mapping widget IDs to their rendered components
  className = 'space-y-5',
}) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [columnLayout, setColumnLayout] = useState(3) // Default to 3 columns for desktop
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
        const parsed = parseInt(savedLayout, 10)
        setColumnLayout(parsed === 1 ? 1 : 3) // Only 1 or 3 columns supported
      }
    }
  }, [userId])

  // Save column layout
  const toggleColumnLayout = (cols) => {
    setColumnLayout(cols)
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${LAYOUT_STORAGE_KEY}_${userId}`, cols.toString())
    }
  }

  // Grid class based on column layout (static classes for Tailwind purging)
  const gridClass = columnLayout === 1 ? '' : 'grid md:grid-cols-3 gap-5'

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
          <div className="h-9 w-32 bg-gray-200 dark:bg-zinc-700 rounded-lg animate-pulse"></div>
          <div className="h-9 w-32 bg-gray-200 dark:bg-zinc-700 rounded-lg animate-pulse"></div>
        </div>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl p-6 animate-pulse"
            style={{ backgroundColor: 'var(--color-bg-card)', minHeight: '150px' }}
          >
            <div className="h-6 bg-gray-200 dark:bg-zinc-700 rounded w-1/4 mb-4"></div>
            <div className="h-24 bg-gray-200 dark:bg-zinc-700 rounded"></div>
          </div>
        ))}
      </div>
    )
  }

  // Get ordered widgets that have components
  const orderedWidgets = getOrderedWidgets().filter(
    widget => widgetComponents[widget.id]
  )

  // Separate top widgets (check-in-out, quick-glance, attendance-summary) from the rest
  const TOP_WIDGET_IDS = new Set(['check-in-out', 'quick-glance', 'attendance-summary'])
  const topWidgets = orderedWidgets.filter(w => TOP_WIDGET_IDS.has(w.id))
  const remainingWidgets = orderedWidgets.filter(w => !TOP_WIDGET_IDS.has(w.id))
  const greeting = (() => {
    const hour = Number(new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()))
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  })()
  const roleLabel = userRole.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

  return (
    <div className="relative">
      <section className="mb-5 flex flex-col gap-4 rounded-[24px] border border-default-200 bg-content1 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">{roleLabel} workspace</p>
          <h1 className="mt-1 truncate text-2xl font-bold text-foreground sm:text-3xl">
            {greeting}{displayName ? `, ${displayName}` : ''}
          </h1>
          <p className="mt-1 text-sm text-default-500">Your priorities, people, and actions in one place.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Edit Mode Toggle */}
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${isEditMode
                ? 'bg-primary-500 text-white'
                : 'border border-default-200 text-foreground hover:bg-default-100'
              }`}
            title={isEditMode ? 'Exit edit mode' : 'Enter edit mode to customize'}
          >
            <FaCog className="h-3.5 w-3.5" />
            <span>{isEditMode ? 'Done Editing' : 'Customize'}</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
          >
            <FaPlus className="h-3.5 w-3.5" />
            <span>Add widget</span>
          </button>
        </div>
      </section>

      {/* Advanced layout controls appear only while customising. */}
      {isEditMode && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-200 bg-primary-50/70 p-3 dark:bg-primary-900/10">
          <p className="text-xs font-medium text-primary-700 dark:text-primary-300">Drag cards to reorder your workspace.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={resetToDefaults}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-default-600 transition-colors hover:bg-content1"
              title="Reset to default layout"
            >
              <FaUndo className="h-3 w-3" />
              <span>Reset layout</span>
            </button>
            <div className="hidden items-center overflow-hidden rounded-lg border border-default-200 bg-content1 md:flex">
            <button
              onClick={() => columnLayout !== 1 && toggleColumnLayout(1)}
              className={`flex min-h-9 items-center gap-1.5 px-3 text-xs font-semibold transition-colors ${
                columnLayout === 1
                  ? 'bg-primary-500 text-white'
                  : 'text-default-500 hover:bg-default-100'
              }`}
              title="Single column layout"
            >
              <FaTh className="w-3 h-3" />
              <span>Focus</span>
            </button>
            <button
              onClick={() => columnLayout !== 3 && toggleColumnLayout(3)}
              className={`flex min-h-9 items-center gap-1.5 px-3 text-xs font-semibold transition-colors ${
                columnLayout === 3
                  ? 'bg-primary-500 text-white'
                  : 'text-default-500 hover:bg-default-100'
              }`}
              title="Three column layout"
            >
              <FaThLarge className="w-3 h-3" />
              <span>Overview</span>
            </button>
          </div>
          </div>
        </div>
      )}

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
            {/* Top Widgets (Check-In/Out, Quick Glance) */}
            {topWidgets.length > 0 && (
              <div className={`${gridClass || className}`} style={columnLayout >= 2 && isDesktop ? { gridAutoRows: 'minmax(280px, 1fr)' } : {}}>
                {topWidgets.map((widget, index) => {
                  const WidgetContent = widgetComponents[widget.id]
                  return (
                    <DraggableWidget
                      key={widget.id}
                      id={widget.id}
                      title={widget.name}
                      colorIndex={index}
                      onRemove={isEditMode ? handleRemoveWidget : null}
                      removable={isEditMode}
                      className="rounded-[22px] overflow-hidden"
                    >
                      {WidgetContent}
                    </DraggableWidget>
                  )
                })}
              </div>
            )}

            {/* Actionable Insights - AI-powered dashboard section */}
            <div className="mt-5">
              <ActionableInsights />
            </div>

            {/* Remaining Widgets */}
            {remainingWidgets.length > 0 && (
              <div className={`mt-5 ${gridClass || className}`} style={columnLayout >= 2 && isDesktop ? { gridAutoRows: 'minmax(280px, 1fr)' } : {}}>
                {remainingWidgets.map((widget, index) => {
                  const WidgetContent = widgetComponents[widget.id]
                  return (
                    <DraggableWidget
                      key={widget.id}
                      id={widget.id}
                      title={widget.name}
                      colorIndex={topWidgets.length + index}
                      onRemove={isEditMode ? handleRemoveWidget : null}
                      removable={isEditMode}
                      className="rounded-[22px] overflow-hidden"
                    >
                      {WidgetContent}
                    </DraggableWidget>
                  )
                })}
              </div>
            )}
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
