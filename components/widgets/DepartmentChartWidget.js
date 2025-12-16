'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { CustomPieTooltip } from '@/components/charts/CustomTooltip'
import { FaBuilding } from 'react-icons/fa'

export default function DepartmentChartWidget({ departmentStats = [] }) {
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

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-800">Department Distribution</h3>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={departmentStats}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            >
              {departmentStats.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomPieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
