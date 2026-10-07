'use client'

import { useState } from 'react'
import { Button, Chip, Skeleton } from '@/components/ui/fernly'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import OnboardingVerificationModal from './OnboardingVerificationModal'
import toast from '@/utils/toast'

export default function EmployeeOnboardingDocuments({ onSubmitted }) {
  const { data, error, isLoading, mutate } = useAuthedSWR('/api/documents/onboarding')
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async verification => {
    setBusy(true)
    try {
      const response = await fetch('/api/documents/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ itemKey: selected.key, verification }) })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to submit documents')
      toast.success(result.message)
      await mutate(); onSubmitted?.()
      return true
    } catch (error) { toast.error(error.message); return false }
    finally { setBusy(false) }
  }
  if (isLoading) return <Skeleton className="mb-6 h-36 rounded-2xl" />
  if (error) return <div className="mb-6 rounded-2xl border border-danger-200 p-4"><p role="alert" className="text-sm text-danger">Unable to load onboarding documents.</p><Button size="sm" variant="flat" onPress={() => mutate()}>Retry</Button></div>
  if (!data?.data?.enabled) return null
  return <section className="mb-6 rounded-2xl border border-default-200 bg-content1 p-5" aria-label="My onboarding documents">
    <h2 className="text-lg font-semibold">My onboarding documents</h2>
    <p className="mt-1 text-sm text-default-500">Upload the joining documents and details requested by HR. Submissions remain pending until HR reviews them.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {(data.data.checklist || []).map(item => <button type="button" key={item.key} className="rounded-xl border border-default-200 p-4 text-left transition hover:border-primary" onClick={() => setSelected(item)}>
        <p className="text-sm font-medium">{item.label}</p>
        <Chip size="sm" variant="flat" className="mt-2" color={item.completed ? 'success' : item.submission ? 'warning' : 'default'}>{item.completed ? 'Verified' : item.submission?.status === 'pending' ? 'Pending HR review' : item.submission?.status === 'changes_requested' ? 'Changes requested' : 'Not submitted'}</Chip>
        {item.submission?.reviewReason && <p className="mt-2 text-xs text-default-500">{item.submission.reviewReason}</p>}
      </button>)}
    </div>
    <OnboardingVerificationModal isOpen={Boolean(selected)} item={selected} linkedEvidence={data.data.linkedEvidence} profilePhone={data.data.profilePhone} mode="submit" onClose={() => setSelected(null)} isProcessing={busy} onVerify={submit} />
  </section>
}
