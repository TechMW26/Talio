'use client'
import { useSearchParams } from 'next/navigation'
import ResignationPanel from '@/components/employees/ResignationPanel'

export default function ResignationsPage() {
  const params = useSearchParams()
  return <div className="w-full p-4 sm:p-6 lg:p-8"><ResignationPanel dashboard requestId={params.get('resignation')} initialView={params.get('view') || 'overview'} /></div>
}
