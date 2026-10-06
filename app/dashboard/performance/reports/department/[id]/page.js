'use client'

import { useParams } from 'next/navigation'
import PerformanceReportsPage from '../../page'

export default function DepartmentPerformancePage() {
  const { id } = useParams()
  return <PerformanceReportsPage key={id} departmentId={id} />
}
