'use client'

import { useRouter } from 'next/navigation'
import { FaChartBar } from 'react-icons/fa'

export default function KPIStatsWidget({ statsData }) {
  const router = useRouter()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <FaChartBar className="w-5 h-5 text-primary-500" />
        <h3 className="text-base sm:text-lg font-bold text-gray-800">Key Statistics</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {statsData.map((stat, index) => {
          const Icon = stat.icon
          return (
            <div
              key={index}
              className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors cursor-pointer"
              onClick={() => stat.href && router.push(stat.href)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-600 text-xs font-medium truncate">{stat.title}</p>
                  <h3 className="text-lg font-bold text-gray-800 mt-1">{stat.value}</h3>
                </div>
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary-600" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
