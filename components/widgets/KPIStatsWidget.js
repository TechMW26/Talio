'use client'

import widgetStyles from './WidgetDesign.module.css'

import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/fernly'
import { FaArrowUp } from 'react-icons/fa'

export default function KPIStatsWidget({ statsData }) {
  const router = useRouter()

  return (
    <div className={`${widgetStyles.surface} p-4 sm:p-6 flex-1 flex flex-col h-full`}>
      <div className="mb-4">
        <h3 className={`${widgetStyles.title} text-base sm:text-lg font-bold text-default-900`}>Key Statistics</h3>
      </div>
      <div className={`${widgetStyles.metricsGrid} ${widgetStyles.statGrid} grid gap-3`}>
        {statsData.map((stat, index) => {
          const Icon = stat.icon
          return (
            <Card data-widget-card="" data-widget-tone={["primary", "success", "warning", "secondary"][index % 4]}
              key={index}
              isPressable={!!stat.href}
              onPress={() => stat.href && router.push(stat.href)}
              className={widgetStyles.statCard}
              radius="lg"
            >
              <CardBody className={widgetStyles.statBody}>
                <div className={widgetStyles.statHead}><p>{stat.title}</p><span aria-hidden="true">{stat.href ? <FaArrowUp /> : Icon && <Icon />}</span></div>
                <strong className={widgetStyles.statValue}>{stat.value}</strong>
                <p className={widgetStyles.statNote}>{stat.href ? 'Open details' : 'Current overview'}</p>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
