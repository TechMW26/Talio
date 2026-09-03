'use client'

import { useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import OffboardingAssetChecklistModal from '@/components/employees/OffboardingAssetChecklistModal'
import OnboardingVerificationModal from '@/components/employees/OnboardingVerificationModal'
import toast from '@/utils/toast'
import { Button, Chip, Progress, Skeleton } from '@heroui/react'
import { FaCheck, FaClock, FaCommentDots, FaFlagCheckered, FaHourglassHalf, FaPaperPlane, FaRoute, FaSyncAlt } from 'react-icons/fa'

const STAGE_LABELS = {
  preboarding: 'Pre-boarding', onboarding: 'Onboarding', probation: 'Probation', confirmed: 'Confirmed',
  notice_period: 'Notice period', offboarding: 'Offboarding', alumni: 'Alumni',
}

function formatIstDate(value) {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

export default function EmployeeLifecyclePanel({ employeeId, onEmployeeRefresh }) {
  const { data, isLoading, mutate } = useAuthedSWR(employeeId ? `/api/employees/${employeeId}/lifecycle` : null, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
  })
  const details = data?.data
  const lifecycle = details?.lifecycle
  const [processing, setProcessing] = useState('')
  const [showExtension, setShowExtension] = useState(false)
  const [showOffboarding, setShowOffboarding] = useState(false)
  const [showAssetClearance, setShowAssetClearance] = useState(false)
  const [verificationItem, setVerificationItem] = useState(null)
  const [extension, setExtension] = useState({ months: 1, reason: '' })
  const [offboarding, setOffboarding] = useState({ separationType: 'resignation', resignationDate: '', lastWorkingDate: '', reason: '' })

  const runAction = async (action, payload = {}) => {
    try {
      setProcessing(action + (payload.itemKey || payload.field || ''))
      const response = await fetch(`/api/employees/${employeeId}/lifecycle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ action, ...payload }),
      })
      const responseText = await response.text()
      let result
      try {
        result = responseText ? JSON.parse(responseText) : null
      } catch {
        result = null
      }
      if (!result) {
        throw new Error(response.ok
          ? 'The lifecycle service returned an invalid response'
          : `Lifecycle update failed (${response.status})`)
      }
      if (!response.ok || !result.success) throw new Error(result.message || 'Lifecycle update failed')
      toast.success(result.message || 'Lifecycle updated')
      await mutate()
      onEmployeeRefresh?.()
      if (action === 'start_offboarding') setShowOffboarding(false)
      return true
    } catch (error) {
      toast.error(error.message)
      return false
    } finally {
      setProcessing('')
    }
  }

  const requestProbationApproval = async (requestType, payload = {}) => {
    try {
      setProcessing(`request_probation_${requestType}`)
      const response = await fetch(`/api/employees/${employeeId}/probation-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ requestType, ...payload }),
      })
      const responseText = await response.text()
      let result
      try {
        result = responseText ? JSON.parse(responseText) : null
      } catch {
        result = null
      }
      if (!result) throw new Error(response.ok ? 'The approval service returned an invalid response' : `Approval request failed (${response.status})`)
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to request probation approval')
      toast.success(result.message || 'Probation approval requested')
      setShowExtension(false)
      await mutate()
    } catch (error) {
      toast.error(error.message)
      await mutate()
    } finally {
      setProcessing('')
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full rounded-3xl lg:col-span-3" />
  if (!lifecycle) return null

  const probation = lifecycle.probation || {}
  const probationApproval = details.probationApproval
  const approvalPending = ['pending', 'processing'].includes(probationApproval?.status)
  const approverName = probationApproval?.approver
    ? `${probationApproval.approver.firstName || ''} ${probationApproval.approver.lastName || ''}`.trim()
    : ''
  const exit = lifecycle.offboarding || {}
  const assetChecklist = exit.assetChecklist || []
  const clearedAssets = assetChecklist.filter((item) => ['returned', 'waived'].includes(item.status)).length
  const canManage = details.permissions?.canManage
  const canOffboard = details.permissions?.canOffboard

  return (
    <section className="rounded-3xl border border-slate-200/60 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-3 sm:p-8" aria-labelledby="employee-lifecycle-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FaRoute className="text-primary" />
            <h2 id="employee-lifecycle-heading" className="text-lg font-bold text-slate-900 dark:text-zinc-100">Employee lifecycle</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Onboarding, probation and offboarding stay attached to this employee.</p>
        </div>
        <Chip color="primary" variant="flat" startContent={<FaClock className="h-3 w-3" />}>
          {STAGE_LABELS[lifecycle.stage] || lifecycle.stage}
        </Chip>
      </div>

      {details.enabled?.onboarding && lifecycle.onboarding && (
        <div className="mt-6 rounded-2xl border border-slate-200 p-5 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-zinc-100">Onboarding checklist</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Target {formatIstDate(lifecycle.onboarding.targetDate)} · {lifecycle.onboarding.template} plan</p>
              {details.automation?.enabled && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-primary-600 dark:text-primary-400">
                  <FaSyncAlt className="h-2.5 w-2.5" /> Progress syncs automatically from employee records and linked HR workflows.
                </p>
              )}
            </div>
            <span className="text-sm font-semibold text-primary">{details.progress?.completed || 0}/{details.progress?.total || 0}</span>
          </div>
          <Progress className="mt-3" aria-label="Onboarding progress" value={details.progress?.percentage || 0} color="primary" />
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {(lifecycle.onboarding.checklist || []).map((item) => {
              const actionKey = `complete_onboarding_item${item.key}`
              const isAutomatic = Object.prototype.hasOwnProperty.call(details.automation?.signals || {}, item.key)
              return (
                <button
                  key={item.key}
                  type="button"
                  disabled={!canManage || processing === actionKey}
                  onClick={() => setVerificationItem(item)}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition hover:border-primary-300 disabled:cursor-default dark:border-zinc-800 dark:hover:border-primary-700"
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${item.completed ? 'border-success bg-success text-white' : 'border-slate-300 dark:border-zinc-600'}`}>
                    {item.completed && <FaCheck className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${item.completed ? 'text-slate-400 line-through dark:text-zinc-500' : 'text-slate-700 dark:text-zinc-200'}`}>{item.label}</span>
                    {isAutomatic && (
                      <span className="mt-0.5 block text-[10px] text-slate-400 dark:text-zinc-500">
                        {item.completionSource === 'system'
                          ? 'Automatically verified from a linked record · View verification'
                          : item.completionSource === 'manual'
                            ? 'Verified with supporting evidence · View verification'
                            : 'Automatically monitored · evidence required for manual completion'}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {details.enabled?.probation && probation.applicable && (
        <div className="mt-4 rounded-2xl border border-slate-200 p-5 dark:border-zinc-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-zinc-100"><FaHourglassHalf className="text-amber-500" /> Probation and confirmation</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">{probation.durationMonths} months · review due {formatIstDate(probation.reviewDate)}</p>
              <p className="mt-1 text-xs capitalize text-slate-500">Status: {String(probation.status || '').replaceAll('_', ' ')}</p>
            </div>
            {canManage && !approvalPending && !['confirmed', 'waived'].includes(probation.status) && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="flat" onPress={() => setShowExtension((value) => !value)}>Extend</Button>
                <Button
                  size="sm"
                  color="success"
                  className="text-white"
                  isLoading={processing === 'request_probation_confirmation'}
                  startContent={!processing && <FaPaperPlane />}
                  onPress={() => requestProbationApproval('confirmation')}
                >
                  Request confirmation
                </Button>
              </div>
            )}
          </div>
          {probationApproval && (
            <div className={`mt-4 rounded-xl border p-4 ${
              approvalPending
                ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
                : probationApproval.status === 'approved'
                  ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                  : 'border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-zinc-100">
                  <FaCommentDots className="text-primary" />
                  {probationApproval.requestType === 'extension' ? 'Extension approval' : 'Confirmation approval'}
                </p>
                <Chip
                  size="sm"
                  variant="flat"
                  color={approvalPending ? 'warning' : probationApproval.status === 'approved' ? 'success' : 'danger'}
                >
                  {approvalPending ? 'Awaiting approval' : probationApproval.status}
                </Chip>
              </div>
              <p className="mt-2 text-xs text-slate-600 dark:text-zinc-300">
                {approvalPending
                  ? `Pending with ${approverName || 'the assigned reporting approver'}`
                  : `${approverName || 'The assigned approver'} responded ${formatIstDate(probationApproval.decidedAt)}`}
                {probationApproval.extensionMonths ? ` · ${probationApproval.extensionMonths} month extension` : ''}
              </p>
              {probationApproval.requestRemarks && (
                <p className="mt-2 text-xs text-slate-600 dark:text-zinc-400"><span className="font-semibold">Request note:</span> {probationApproval.requestRemarks}</p>
              )}
              {probationApproval.decisionRemarks && (
                <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400"><span className="font-semibold">Manager remarks:</span> {probationApproval.decisionRemarks}</p>
              )}
            </div>
          )}
          {showExtension && !approvalPending && (
            <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 dark:bg-zinc-900 sm:grid-cols-[140px_1fr_auto]">
              <select value={extension.months} onChange={(event) => setExtension((value) => ({ ...value, months: Number(event.target.value) }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950">
                <option value={1}>1 month</option><option value={2}>2 months</option><option value={3}>3 months</option><option value={6}>6 months</option>
              </select>
              <input value={extension.reason} onChange={(event) => setExtension((value) => ({ ...value, reason: event.target.value }))} placeholder="Required reason for extension" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              <Button
                color="primary"
                isDisabled={!extension.reason.trim()}
                isLoading={processing === 'request_probation_extension'}
                onPress={() => requestProbationApproval('extension', { months: extension.months, remarks: extension.reason })}
              >
                Request approval
              </Button>
            </div>
          )}
        </div>
      )}

      {details.enabled?.offboarding && canOffboard && lifecycle.stage !== 'alumni' && (
        <div className="mt-4 rounded-2xl border border-slate-200 p-5 dark:border-zinc-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-zinc-100"><FaFlagCheckered className="text-rose-500" /> Separation and offboarding</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Start the notice, clearance, settlement and alumni flow here when needed.</p>
            </div>
            {exit.status === 'not_started' && <Button size="sm" variant="flat" color="danger" onPress={() => setShowOffboarding((value) => !value)}>Start offboarding</Button>}
          </div>

          {showOffboarding && exit.status === 'not_started' && (
            <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 dark:bg-zinc-900 md:grid-cols-2">
              <select value={offboarding.separationType} onChange={(event) => setOffboarding((value) => ({ ...value, separationType: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950">
                <option value="resignation">Resignation</option><option value="termination">Termination</option><option value="retirement">Retirement</option><option value="contract_end">Contract end</option><option value="other">Other</option>
              </select>
              <input type="date" aria-label="Resignation date" value={offboarding.resignationDate} onChange={(event) => setOffboarding((value) => ({ ...value, resignationDate: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              <input type="date" aria-label="Last working date" value={offboarding.lastWorkingDate} onChange={(event) => setOffboarding((value) => ({ ...value, lastWorkingDate: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              <input value={offboarding.reason} onChange={(event) => setOffboarding((value) => ({ ...value, reason: event.target.value }))} placeholder="Reason or notes" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              <Button className="md:col-span-2" color="danger" isLoading={processing === 'start_offboarding'} onPress={() => runAction('start_offboarding', offboarding)}>Begin notice and clearance</Button>
            </div>
          )}

          {exit.status !== 'not_started' && (
            <div className="mt-4">
              <p className="mb-3 text-xs text-slate-500">Last working date: {formatIstDate(exit.lastWorkingDate)}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { field: 'exitInterviewCompleted', label: 'Exit interview', completed: Boolean(exit.exitInterviewCompleted) },
                  { field: 'assetsReturned', label: assetChecklist.length ? `Assets (${clearedAssets}/${assetChecklist.length})` : 'Asset clearance', completed: Boolean(exit.assetsReturned), connected: true },
                  { field: 'accessRevoked', label: 'Access revoked', completed: Boolean(exit.accessRevoked) },
                  { field: 'fullAndFinalStatus', label: 'Full and final', completed: exit.fullAndFinalStatus === 'completed' },
                ].map(({ field, label, completed, connected }) => (
                  <button
                    key={field}
                    type="button"
                    onClick={() => connected
                      ? setShowAssetClearance(true)
                      : runAction('update_offboarding', { field, value: field === 'fullAndFinalStatus' ? (completed ? 'pending' : 'completed') : !completed })}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-left text-sm transition hover:border-primary-300 dark:border-zinc-800 dark:hover:border-primary-700"
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${completed ? 'bg-success text-white' : 'border border-slate-300 dark:border-zinc-600'}`}>{completed && <FaCheck className="h-2.5 w-2.5" />}</span>
                    <span>{label}{connected && <span className="ml-1 text-xs text-primary">View checklist</span>}</span>
                  </button>
                ))}
              </div>
              <Button className="mt-4" color="primary" isLoading={processing === 'complete_offboarding'} onPress={() => runAction('complete_offboarding')}>Complete offboarding</Button>
            </div>
          )}
        </div>
      )}
      <OffboardingAssetChecklistModal
        isOpen={showAssetClearance}
        employeeId={employeeId}
        onClose={() => setShowAssetClearance(false)}
        onUpdated={async () => {
          await mutate()
          onEmployeeRefresh?.()
        }}
      />
      <OnboardingVerificationModal
        isOpen={Boolean(verificationItem)}
        item={verificationItem}
        isProcessing={processing === `complete_onboarding_item${verificationItem?.key || ''}`}
        onClose={() => setVerificationItem(null)}
        onVerify={(verification) => runAction('complete_onboarding_item', {
          itemKey: verificationItem?.key,
          completed: true,
          verification,
        })}
        onReopen={(reason) => runAction('complete_onboarding_item', {
          itemKey: verificationItem?.key,
          completed: false,
          reason,
        })}
      />
    </section>
  )
}
