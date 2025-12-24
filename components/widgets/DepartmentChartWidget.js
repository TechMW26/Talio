'use client'

import { useState, useRef, useEffect } from 'react'
import { FaBuilding } from 'react-icons/fa'

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

// Minimum bar width before overflow kicks in
const MIN_BAR_WIDTH = 24
// Gap between bars
const BAR_GAP = 12

export default function DepartmentChartWidget({ departmentStats = [] }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useRef(null)

  // Measure container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth)
      }
    }
    
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  if (!departmentStats || departmentStats.length === 0) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <div className="mb-4">
          <h3 className="text-base sm:text-lg font-bold text-gray-800">Department Distribution</h3>
        </div>
        <div className="text-center py-6 text-gray-500">
          <FaBuilding className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No department data available</p>
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

  // Calculate dynamic bar width
  const numBars = departmentStats.length
  const totalGapWidth = (numBars - 1) * BAR_GAP
  const availableWidth = containerWidth - 32 // Account for padding (px-4 = 16px * 2)
  const calculatedBarWidth = numBars > 0 ? (availableWidth - totalGapWidth) / numBars : MIN_BAR_WIDTH
  
  // Use calculated width if >= min, otherwise use min width (will trigger overflow)
  const barWidth = Math.max(calculatedBarWidth, MIN_BAR_WIDTH)
  const needsOverflow = calculatedBarWidth < MIN_BAR_WIDTH
  const totalContentWidth = needsOverflow ? (numBars * MIN_BAR_WIDTH) + totalGapWidth + 32 : '100%'

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-800">Department Distribution</h3>
      </div>
      
      {/* Scrollable container for bar chart */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-x-auto"
      >
        <div 
          className="flex items-end justify-between px-4"
          style={{ 
            height: `${chartHeight}px`, 
            width: totalContentWidth,
            minWidth: needsOverflow ? `${totalContentWidth}px` : undefined,
            gap: `${BAR_GAP}px`
          }}
        >
          {departmentStats.map((dept, index) => {
            const percentage = total > 0 ? ((dept.value / total) * 100) : 0
            // Calculate height based on value relative to max
            const barHeight = maxValue > 0 ? Math.max((dept.value / maxValue) * chartHeight, 20) : 20
            const color = CHART_COLORS[index % CHART_COLORS.length]
            const isHovered = hoveredIndex === index
            
            return (
              <div 
                key={dept.name || index} 
                className="relative flex flex-col items-center"
                style={{ flex: needsOverflow ? '0 0 auto' : 1 }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Tooltip on hover - matching CustomPieTooltip style */}
                {isHovered && (
                  <div className="absolute bottom-full mb-3 z-20 pointer-events-none left-1/2 -translate-x-1/2">
                    <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden min-w-[140px]">
                      {/* Tooltip Header with department color */}
                      <div 
                        className="px-3 py-2 border-b border-gray-200"
                        style={{ backgroundColor: color }}
                      >
                        <p className="text-xs sm:text-sm font-semibold text-white truncate">
                          {dept.name}
                        </p>
                      </div>
                      
                      {/* Tooltip Content */}
                      <div className="px-3 py-2 bg-white">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs sm:text-sm text-gray-600">
                            Employees:
                          </span>
                          <span className="text-xs sm:text-sm font-semibold text-gray-900">
                            {dept.value}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-1">
                          <span className="text-xs sm:text-sm text-gray-600">
                            Percentage:
                          </span>
                          <span className="text-xs sm:text-sm font-semibold text-gray-900">
                            {percentage.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Arrow */}
                    <div className="flex justify-center -mt-[1px]">
                      <div 
                        className="w-3 h-3 bg-white border-r border-b border-gray-200 transform rotate-45"
                      />
                    </div>
                  </div>
                )}
                
                {/* Bar */}
                <div 
                  className="cursor-pointer transition-all duration-200 rounded-t"
                  style={{ 
                    width: needsOverflow ? `${MIN_BAR_WIDTH}px` : '100%',
                    maxWidth: '48px',
                    height: `${barHeight}px`,
                    backgroundColor: color,
                    boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.1)',
                    transform: isHovered ? 'scaleX(1.1)' : 'scaleX(1)',
                    opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
      
      {/* Summary line at bottom */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 text-center">
          {departmentStats.length} departments • {total} total employees
        </p>
      </div>
    </div>
  )
}
