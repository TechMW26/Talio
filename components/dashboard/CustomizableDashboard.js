'use client'

import { useState, useEffect, useRef } from 'react'
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
import { groupDashboardWidgets, isWideDashboardWidget } from '@/lib/dashboardSections'
import { WIDGET_REGISTRY } from '@/lib/widgetRegistry'
import { FaPlus, FaUndo, FaCog } from 'react-icons/fa'

function DeferredWidgetContent({ children, eager = false, scrollableList = false }) {
  const minimumHeight = scrollableList ? 'min-h-[320px] sm:min-h-[400px]' : 'min-h-[280px]'
  const containerRef = useRef(null)
  const [shouldRender, setShouldRender] = useState(eager)

  useEffect(() => {
    if (eager) setShouldRender(true)
  }, [eager])

  useEffect(() => {
    if (shouldRender || typeof IntersectionObserver === 'undefined') {
      if (!shouldRender) setShouldRender(true)
      return undefined
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldRender(true)
        observer.disconnect()
      }
    }, { rootMargin: '600px 0px' })

    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [shouldRender])

  return (
    <div ref={containerRef} data-scrollable-widget={scrollableList || undefined} className={`h-full ${minimumHeight} ${scrollableList ? 'grid grid-rows-[minmax(0,1fr)]' : ''}`} aria-busy={!shouldRender}>
      {shouldRender ? children : (
        <div className={`h-full ${minimumHeight} animate-pulse p-5`} role="status" aria-label="Loading dashboard widget">
          <div className="mb-5 h-5 w-2/5 rounded-lg bg-default-200" />
          <div className={`${scrollableList ? 'h-[230px] sm:h-[310px]' : 'h-[190px]'} rounded-2xl bg-default-100`} />
        </div>
      )}
    </div>
  )
}

export default function CustomizableDashboard({
  userId,
  userRole = 'employee',
  displayName = '',
  attendanceSummary = null,
  widgetComponents,  // Object mapping widget IDs to their rendered components
  className = 'space-y-5',
}) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const {
    enabledWidgets,
    isInitialized,
    addWidget,
    removeWidget,
    handleDragEnd,
    resetToDefaults,
    getOrderedWidgets,
  } = useDashboardWidgets(userId, userRole, Object.keys(widgetComponents))

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
  const taskFallback = ['today-tasks', 'project-tasks'].find(id => widgetComponents[id])
  const sections = groupDashboardWidgets(orderedWidgets, taskFallback ? WIDGET_REGISTRY[taskFallback] : null)
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
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_350px]">
      <div className="min-w-0" data-dashboard-widget-area>
      <section className="mb-5 flex flex-col gap-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">{roleLabel} workspace</p>
          <h1 className="mt-1 truncate text-2xl font-bold text-foreground sm:text-3xl">
            {greeting}{displayName ? `, ${displayName}` : ''}
          </h1>
          <div className="mt-3">{attendanceSummary}</div>
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
          <p className="text-xs font-medium text-primary-700 dark:text-primary-300">Drag cards to reorder within their section. Check-in stays first.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={resetToDefaults}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-default-600 transition-colors hover:bg-content1"
              title="Reset to default layout"
            >
              <FaUndo className="h-3 w-3" />
              <span>Reset layout</span>
            </button>
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
            items={sections.flatMap(section => section.widgets.map(w => w.id))}
            strategy={rectSortingStrategy}
          >
              <div className="min-w-0 space-y-7">
                {sections.map(section => (
                  <section key={section.id} aria-labelledby={`dashboard-${section.id}`}>
                    <div className={section.id === 'attendance' ? 'sr-only' : 'mb-4'}>
                      <h2 id={`dashboard-${section.id}`} className="text-lg font-semibold text-foreground">{section.title}</h2>
                      <p className="mt-1 text-sm text-default-500">{section.description}</p>
                    </div>
                    <div className="grid min-w-0 gap-5 md:grid-cols-2">
                      {section.widgets.map((widget, index) => (
                        <DraggableWidget
                          key={widget.id}
                          id={widget.id}
                          title={widget.name}
                          colorIndex={index}
                          onRemove={isEditMode && widget.id !== 'check-in-out' ? handleRemoveWidget : null}
                          removable={isEditMode && widget.id !== 'check-in-out'}
                          frameless={widget.id === 'check-in-out'}
                          className={`min-w-0 ${isWideDashboardWidget(widget.id) ? 'md:col-span-2' : ''} ${widget.id === 'check-in-out' ? '' : 'rounded-[18px] overflow-hidden'}`}
                        >
                          <DeferredWidgetContent eager={section.id === 'attendance' || isEditMode} scrollableList={WIDGET_REGISTRY[widget.id]?.scrollableList === true}>
                            {widgetComponents[widget.id]}
                          </DeferredWidgetContent>
                        </DraggableWidget>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
          </SortableContext>
        </DndContext>
      )}

      </div>
      <aside aria-label="Quick tools" className="min-w-0 self-start overflow-hidden rounded-2xl border border-default-200 bg-content1 xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)] xl:supports-[height:100dvh]:h-[calc(100dvh-7rem)]">
        <ActionableInsights vertical />
      </aside>
      </div>

      {/* Add Widget Modal */}
      <AddWidgetModal
        availableWidgetIds={Object.keys(widgetComponents)}
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAddWidget={handleAddWidget}
        enabledWidgets={enabledWidgets}
        userRole={userRole}
      />
    </div>
  )
}
