'use client'

import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@heroui/react'
import { FaChartBar } from 'react-icons/fa'

export default function KPIStatsWidget({ statsData }) {
  const router = useRouter()

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">Key Statistics</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {statsData.map((stat, index) => {
          const Icon = stat.icon
          return (
            <Card
              key={index}
              isPressable={!!stat.href}
              isHoverable
              onPress={() => stat.href && router.push(stat.href)}
              className="border border-default-100 transition-all hover:shadow-md hover:border-primary-200"
              radius="lg"
            >
              <CardBody className="p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-default-500 text-xs font-medium truncate">{stat.title}</p>
                    <h3 className="text-xl font-bold text-default-900 mt-1">{stat.value}</h3>
                  </div>
                  <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-primary-600" />
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
