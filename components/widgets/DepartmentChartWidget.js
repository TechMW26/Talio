'use client'

import widgetStyles from './WidgetDesign.module.css'
import { FernlyBars } from '@/components/charts/FernlyCharts'

export default function DepartmentChartWidget({ departmentStats = [] }) {
  const rows = departmentStats.map(row => ({ ...row, value: Number.isFinite(Number(row.value)) ? Math.max(0, Number(row.value)) : 0 }))
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return <div className={`${widgetStyles.surface} p-4 sm:p-6 flex-1 flex flex-col h-full`}>
    <h3 className={`${widgetStyles.title} text-base sm:text-lg font-bold text-default-900 mb-4`}>Department Distribution</h3>
    {!rows.length ? <div className="flex flex-col items-center justify-center text-center py-6"><img src="/assets/Department-Distribution.png" alt="" className="w-24 h-24 object-contain mb-3" /><p className="text-sm text-default-500">No department data available</p></div>
      : <FernlyBars data={rows} percentageLabels label="Department distribution" valueLabel="employees" emptyMessage="No employees in these departments yet" />}
    <p className="mt-3 pt-3 border-t border-default-100 text-xs text-default-500 text-center">{rows.length} departments · {total} total employees</p>
  </div>
}
