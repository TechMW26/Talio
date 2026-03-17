'use client'

import { useState, useMemo } from 'react'
import { FaTimes, FaPlus, FaCheck, FaSearch } from 'react-icons/fa'
import { getCategorizedWidgets, getCategoryDisplayName, WIDGET_CATEGORIES } from '@/lib/widgetRegistry'
import ModalPortal from '@/components/ui/ModalPortal'

export default function AddWidgetModal({
  isOpen,
  onClose,
  onAddWidget,
  enabledWidgets = [],
  userRole = 'employee'
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')

  // Ensure we always have a valid role for filtering - default to 'employee' if undefined/null
  const effectiveRole = userRole || 'employee'

  // Get all widgets categorized for the user's role
  const categorizedWidgets = useMemo(() =>
    getCategorizedWidgets(effectiveRole),
    [effectiveRole]
  )

  // Filter widgets based on search and category
  const filteredWidgets = useMemo(() => {
    let widgets = []

    Object.entries(categorizedWidgets).forEach(([category, { widgets: categoryWidgets }]) => {
      if (selectedCategory === 'all' || selectedCategory === category) {
        categoryWidgets.forEach(widget => {
          if (
            searchQuery === '' ||
            widget.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            widget.description.toLowerCase().includes(searchQuery.toLowerCase())
          ) {
            widgets.push({ ...widget, category })
          }
        })
      }
    })

    return widgets
  }, [categorizedWidgets, selectedCategory, searchQuery])

  // Check if widget is already enabled
  const isWidgetEnabled = (widgetId) => {
    return enabledWidgets.includes(widgetId)
  }

  const handleAddWidget = (widget) => {
    if (!isWidgetEnabled(widget.id)) {
      onAddWidget(widget)
    }
  }

  if (!isOpen) return null

  return (
    <ModalPortal isOpen={isOpen}>
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-backdrop" />
        <div className="modal-container modal-3xl">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-primary-500 to-primary-600">
            <div>
              <h2 className="text-xl font-bold text-white">Add Widget</h2>
              <p className="text-primary-100 text-sm mt-0.5">Customize your dashboard with widgets</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-black/10 bg-white/90 rounded-lg transition-colors"
            >
              <FaTimes className="w-5 h-5 text-gray-800" />
            </button>
          </div>

        {/* Search and Filter */}
        <div className="px-6 py-4 border-b border-gray-100 space-y-3">
          {/* Search Input */}
          <div className="input-with-icon">
            <FaSearch className="input-icon w-4 h-4" />
            <input
              type="text"
              placeholder="Search widgets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input input-search"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedCategory === 'all'
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
              All
            </button>
            {Object.keys(categorizedWidgets).map(category => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedCategory === category
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                {getCategoryDisplayName(category)}
              </button>
            ))}
          </div>
        </div>

        {/* Widget Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredWidgets.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <FaSearch className="w-6 h-6 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium">No widgets found</p>
              <p className="text-gray-400 text-sm mt-1">Try a different search term or category</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredWidgets.map(widget => {
                const Icon = widget.icon
                const isEnabled = isWidgetEnabled(widget.id)

                return (
                  <div
                    key={widget.id}
                    className={`relative p-4 rounded-xl border-2 transition-all ${isEnabled
                      ? 'border-green-200 bg-green-50'
                      : 'border-gray-100 hover:border-primary-200 hover:shadow-md cursor-pointer bg-white'
                      }`}
                    onClick={() => !isEnabled && handleAddWidget(widget)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className={`p-3 rounded-lg flex-shrink-0 ${isEnabled ? 'bg-green-100' : 'bg-primary-50'
                        }`}>
                        <Icon className={`w-5 h-5 ${isEnabled ? 'text-green-600' : 'text-primary-500'
                          }`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-800 text-sm">{widget.name}</h3>
                          {isEnabled && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                              Added
                            </span>
                          )}
                        </div>
                        <p className="text-gray-500 text-xs mt-1 line-clamp-2">
                          {widget.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                            {getCategoryDisplayName(widget.category)}
                          </span>
                        </div>
                      </div>

                      {/* Add/Added Indicator */}
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isEnabled
                        ? 'bg-green-500'
                        : 'bg-primary-500 hover:bg-primary-600'
                        }`}>
                        {isEnabled ? (
                          <FaCheck className="w-3.5 h-3.5 text-white" />
                        ) : (
                          <FaPlus className="w-3.5 h-3.5 text-white" />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer justify-between">
          <p className="text-sm text-gray-500">
            {enabledWidgets.length} widget{enabledWidgets.length !== 1 ? 's' : ''} on your dashboard
          </p>
          <button
            onClick={onClose}
            className="modal-btn modal-btn-primary"
          >
            Done
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  )
}
