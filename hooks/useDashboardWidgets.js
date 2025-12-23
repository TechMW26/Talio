'use client'

import { useState, useEffect, useCallback } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { getDefaultWidgetsForRole, WIDGET_REGISTRY } from '@/lib/widgetRegistry'

const STORAGE_KEY = 'dashboard_widgets_config'

/**
 * Custom hook to manage dashboard widgets
 * Handles adding, removing, reordering widgets with localStorage persistence
 */
export function useDashboardWidgets(userId = 'default', userRole = 'employee') {
  const [enabledWidgets, setEnabledWidgets] = useState([])
  const [widgetOrder, setWidgetOrder] = useState([])
  const [isInitialized, setIsInitialized] = useState(false)

  // Generate unique storage key per user
  const storageKey = `${STORAGE_KEY}_${userId}`

  // Ensure we have a valid role - default to 'employee'
  const effectiveRole = userRole || 'employee'

  // Load saved configuration from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const savedConfig = localStorage.getItem(storageKey)

      if (savedConfig) {
        const { enabled, order } = JSON.parse(savedConfig)

        // Validate that saved widgets still exist in registry AND are allowed for this role
        const validEnabled = enabled.filter(id => {
          const widget = WIDGET_REGISTRY[id]
          return widget && widget.roles && widget.roles.includes(effectiveRole)
        })
        const validOrder = order.filter(id => validEnabled.includes(id))

        // Add any enabled widgets that aren't in order
        validEnabled.forEach(id => {
          if (!validOrder.includes(id)) {
            validOrder.push(id)
          }
        })

        setEnabledWidgets(validEnabled)
        setWidgetOrder(validOrder)
      } else {
        // First time - use default widgets for role
        const defaultWidgets = getDefaultWidgetsForRole(effectiveRole)
        const defaultIds = defaultWidgets.map(w => w.id)

        setEnabledWidgets(defaultIds)
        setWidgetOrder(defaultIds)
      }
    } catch (error) {
      console.error('Error loading dashboard widgets config:', error)
      // Fallback to defaults
      const defaultWidgets = getDefaultWidgetsForRole(effectiveRole)
      const defaultIds = defaultWidgets.map(w => w.id)
      setEnabledWidgets(defaultIds)
      setWidgetOrder(defaultIds)
    }

    setIsInitialized(true)
  }, [storageKey, effectiveRole])

  // Save configuration to localStorage
  const saveConfig = useCallback((enabled, order) => {
    if (typeof window === 'undefined') return

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        enabled,
        order,
        lastUpdated: Date.now()
      }))
    } catch (error) {
      console.error('Error saving dashboard widgets config:', error)
    }
  }, [storageKey])

  // Add a widget
  const addWidget = useCallback((widgetId) => {
    if (!WIDGET_REGISTRY[widgetId]) {
      console.warn(`Widget ${widgetId} not found in registry`)
      return false
    }

    if (enabledWidgets.includes(widgetId)) {
      console.warn(`Widget ${widgetId} is already enabled`)
      return false
    }

    const newEnabled = [...enabledWidgets, widgetId]
    const newOrder = [...widgetOrder, widgetId]

    setEnabledWidgets(newEnabled)
    setWidgetOrder(newOrder)
    saveConfig(newEnabled, newOrder)

    return true
  }, [enabledWidgets, widgetOrder, saveConfig])

  // Remove a widget
  const removeWidget = useCallback((widgetId) => {
    const newEnabled = enabledWidgets.filter(id => id !== widgetId)
    const newOrder = widgetOrder.filter(id => id !== widgetId)

    setEnabledWidgets(newEnabled)
    setWidgetOrder(newOrder)
    saveConfig(newEnabled, newOrder)
  }, [enabledWidgets, widgetOrder, saveConfig])

  // Reorder widgets (handle drag end)
  const handleDragEnd = useCallback((event) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = widgetOrder.indexOf(active.id)
      const newIndex = widgetOrder.indexOf(over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(widgetOrder, oldIndex, newIndex)
        setWidgetOrder(newOrder)
        saveConfig(enabledWidgets, newOrder)
      }
    }
  }, [widgetOrder, enabledWidgets, saveConfig])

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    const defaultWidgets = getDefaultWidgetsForRole(userRole)
    const defaultIds = defaultWidgets.map(w => w.id)

    setEnabledWidgets(defaultIds)
    setWidgetOrder(defaultIds)

    if (typeof window !== 'undefined') {
      localStorage.removeItem(storageKey)
    }
  }, [userRole, storageKey])

  // Get ordered widgets with their metadata
  const getOrderedWidgets = useCallback(() => {
    return widgetOrder
      .filter(id => enabledWidgets.includes(id))
      .map(id => ({
        ...WIDGET_REGISTRY[id],
        id,
      }))
  }, [widgetOrder, enabledWidgets])

  // Check if a widget is enabled
  const isWidgetEnabled = useCallback((widgetId) => {
    return enabledWidgets.includes(widgetId)
  }, [enabledWidgets])

  // Toggle a widget
  const toggleWidget = useCallback((widgetId) => {
    if (enabledWidgets.includes(widgetId)) {
      removeWidget(widgetId)
    } else {
      addWidget(widgetId)
    }
  }, [enabledWidgets, addWidget, removeWidget])

  return {
    enabledWidgets,
    widgetOrder,
    isInitialized,
    addWidget,
    removeWidget,
    handleDragEnd,
    resetToDefaults,
    getOrderedWidgets,
    isWidgetEnabled,
    toggleWidget,
  }
}

export default useDashboardWidgets
