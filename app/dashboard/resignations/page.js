'use client'
import { useSearchParams } from 'next/navigation'
import ResignationPanel from '@/components/employees/ResignationPanel'

export default function ResignationsPage() {
  const params = useSearchParams()
  return <div className="mx-auto max-w-6xl p-4 sm:p-6"><h1 className="text-2xl font-bold">Resignations &amp; Exits</h1><p className="mt-2 text-sm text-default-500">Manage resignation approvals, notice-period discussions and full-and-final settlement.</p><ResignationPanel requestId={params.get('resignation')} initialView={params.get('view') || 'overview'} /></div>
}
