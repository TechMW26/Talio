'use client'

import { useState, useRef } from 'react'
import { FaBuilding } from 'react-icons/fa'
import { Card, CardBody } from '@heroui/react'

// Bright, vibrant color palette for departments
const CHART_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#14B8A6', // Teal
  '#6366F1', // Indigo
  '#84CC16', // Lime
  '#A855F7', // Purple
  '#22D3EE', // Sky
  '#FB7185', // Rose
  '#FBBF24', // Yellow
]

// Minimum bar width before horizontal scroll kicks in
const MIN_BAR_WIDTH = 20

export default function DepartmentChartWidget({ departmentStats = [] }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const containerRef = useRef(null)

  if (!departmentStats || departmentStats.length === 0) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <div className="mb-4">
          <h3 className="text-base sm:text-lg font-bold text-default-900">Department Distribution</h3>
        </div>
        <div className="flex flex-col items-center justify-center text-center py-6">
          <img
            src="/assets/Department-Distribution.png"
            alt="No department data"
            className="w-24 h-24 object-contain mb-3"
          />
          <p className="text-sm text-default-500">No department data available</p>
        </div>
      </div>
    )
  }

  // Calculate total for percentage
  const total = departmentStats.reduce((sum, dept) => sum + (dept.value || 0), 0)

  // Find max value for scaling bar heights
  const maxValue = Math.max(...departmentStats.map(d => d.value || 0))

  // Chart height in pixels
  const chartHeight = 160

  const numBars = departmentStats.length
  // Dynamic gap: smaller when many bars, larger when few
  const dynamicGap = numBars > 20 ? 2 : numBars > 10 ? 4 : 6

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full relative">
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">Department Distribution</h3>
      </div>

      {/* Centralized Tooltip - always positioned in center of widget */}
      {hoveredIndex !== null && departmentStats[hoveredIndex] && (() => {
        const dept = departmentStats[hoveredIndex]
        const percentage = total > 0 ? ((dept.value / total) * 100) : 0
        const color = CHART_COLORS[hoveredIndex % CHART_COLORS.length]

        return (
          <div className="absolute left-1/2 top-12 -translate-x-1/2 z-20 pointer-events-none">
            <Card className="min-w-[140px] shadow-lg">
              {/* Tooltip Header with department color */}
              <div
                className="px-3 py-2 border-b border-default-200"
                style={{ backgroundColor: color }}
              >
                <p className="text-xs sm:text-sm font-semibold text-white truncate">
                  {dept.name}
                </p>
              </div>

              {/* Tooltip Content */}
              <CardBody className="px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs sm:text-sm text-default-600">
                    Employees:
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-default-900">
                    {dept.value}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="text-xs sm:text-sm text-default-600">
                    Percentage:
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-default-900">
                    {percentage.toFixed(1)}%
                  </span>
                </div>
              </CardBody>
            </Card>
          </div>
        )
      })()}

      {/* Bar chart fills full width */}
      <div ref={containerRef} className="flex-1">
        <div
          className="flex items-end w-full h-full"
          style={{
            height: `${chartHeight}px`,
            gap: `${dynamicGap}px`,
          }}
        >
          {departmentStats.map((dept, index) => {
            // Calculate height based on value relative to max
            const barHeight = maxValue > 0 ? Math.max((dept.value / maxValue) * chartHeight, 8) : 8
            const color = CHART_COLORS[index % CHART_COLORS.length]
            const isHovered = hoveredIndex === index

            return (
              <div
                key={dept.name || index}
                className="flex-1 flex items-end h-full"
                style={{ minWidth: 0 }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Bar — fills full slot width */}
                <div
                  className="w-full cursor-pointer transition-all duration-200 rounded-t"
                  style={{
                    height: `${barHeight}px`,
                    backgroundColor: color,
                    boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.1)',
                    transform: isHovered ? 'scaleY(1.03)' : 'scaleY(1)',
                    transformOrigin: 'bottom',
                    opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1,
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary line at bottom */}
      <div className="mt-3 pt-3 border-t border-default-100">
        <p className="text-xs text-default-500 text-center">
          {departmentStats.length} departments • {total} total employees
        </p>
      </div>
    </div>
  )
}
