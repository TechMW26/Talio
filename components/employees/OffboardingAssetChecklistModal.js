'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Skeleton,
} from '@heroui/react'
import { FaBox, FaCheck, FaExclamationTriangle, FaUndoAlt } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import toast from '@/utils/toast'

const RETURN_CONDITIONS = [
  ['excellent', 'Excellent'],
  ['good', 'Good'],
  ['fair', 'Fair'],
  ['poor', 'Poor'],
  ['damaged', 'Damaged'],
]

function formatIstDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function OffboardingAssetChecklistModal({ isOpen, employeeId, onClose, onUpdated }) {
  const endpoint = isOpen && employeeId ? `/api/employees/${employeeId}/offboarding-assets` : null
  const { data, error, isLoading, mutate } = useAuthedSWR(endpoint)
  const [drafts, setDrafts] = useState({})
  const [processingAssetId, setProcessingAssetId] = useState('')
  const responsePayload = data?.data
  const payload = String(responsePayload?.employee?._id || '') === String(employeeId || '') ? responsePayload : null
  const isChecklistLoading = isLoading || (Boolean(endpoint) && !payload && !error)
  const checklist = payload?.checklist || []
  const summary = payload?.summary || { total: 0, cleared: 0, pending: 0, complete: false }

  useEffect(() => {
    if (!checklist.length) return
    setDrafts((current) => Object.fromEntries(checklist.map((item) => {
      const assetId = String(item.asset)
      return [assetId, {
        returnCondition: current[assetId]?.returnCondition || item.returnCondition || 'good',
        notes: current[assetId]?.notes ?? item.notes ?? '',
      }]
    })))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const progress = useMemo(
    () => summary.total ? Math.round((summary.cleared / summary.total) * 100) : 100,
    [summary.cleared, summary.total],
  )

  const updateDraft = (assetId, field, value) => {
    setDrafts((current) => ({
      ...current,
      [assetId]: { returnCondition: 'good', notes: '', ...current[assetId], [field]: value },
    }))
  }

  const clearAsset = async (item, action = 'return') => {
    const assetId = String(item.asset)
    const draft = drafts[assetId] || { returnCondition: 'good', notes: '' }
    setProcessingAssetId(assetId)
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          action,
          assetId,
          returnCondition: draft.returnCondition,
          notes: draft.notes,
        }),
      })
      const responseText = await response.text()
      let result = null
      try { result = responseText ? JSON.parse(responseText) : null } catch { /* handled below */ }
      if (!result) throw new Error(response.ok ? 'The asset service returned an invalid response' : `Asset return failed (${response.status})`)
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to clear the asset')
      await mutate(result, { revalidate: false })
      await onUpdated?.(result.data)
      toast.success(result.message || 'Asset clearance updated')
    } catch (requestError) {
      toast.error(requestError.message || 'Unable to clear the asset')
    } finally {
      setProcessingAssetId('')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose?.() }}
      size="3xl"
      scrollBehavior="inside"
      classNames={{ base: 'rounded-3xl', header: 'rounded-t-3xl', footer: 'rounded-b-3xl' }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 border-b border-default-200">
          <span>Assigned asset clearance</span>
          <span className="text-sm font-normal text-default-500">Return assets connected to this employee before completing offboarding.</span>
        </ModalHeader>
        <ModalBody className="gap-4 py-5">
          <div className="rounded-2xl border border-default-200 bg-default-50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Clearance progress</p>
                <p className="mt-0.5 text-xs text-default-500">
                  {summary.total === 0 ? 'No assets are currently assigned' : `${summary.cleared} of ${summary.total} assets cleared`}
                </p>
              </div>
              <Chip color={summary.complete ? 'success' : 'warning'} variant="flat">
                {summary.complete ? 'Complete' : `${summary.pending} pending`}
              </Chip>
            </div>
            <Progress className="mt-3" aria-label="Asset clearance progress" value={progress} color={summary.complete ? 'success' : 'primary'} />
          </div>

          {isChecklistLoading && <div className="space-y-3">{[1, 2].map((item) => <Skeleton key={item} className="h-40 rounded-2xl" />)}</div>}

          {error && !isChecklistLoading && (
            <div className="rounded-2xl border border-danger-200 bg-danger-50 p-5 text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-200">
              <div className="flex items-start gap-3">
                <FaExclamationTriangle className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1"><p className="font-semibold">Asset checklist could not be loaded</p><p className="mt-1 text-sm">{error.message}</p></div>
                <Button size="sm" variant="flat" color="danger" onPress={() => mutate()}>Retry</Button>
              </div>
            </div>
          )}

          {!isChecklistLoading && !error && checklist.length === 0 && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-default-300 px-6 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-300"><FaCheck /></span>
              <p className="mt-3 font-semibold">No assigned assets</p>
              <p className="mt-1 max-w-md text-sm text-default-500">Asset clearance is automatically complete because the asset register has no equipment assigned to this employee.</p>
            </div>
          )}

          {!isChecklistLoading && !error && checklist.map((item) => {
            const assetId = String(item.asset)
            const draft = drafts[assetId] || { returnCondition: item.returnCondition || 'good', notes: item.notes || '' }
            const cleared = ['returned', 'waived'].includes(item.status)
            return (
              <article key={assetId} className="rounded-2xl border border-default-200 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${cleared ? 'bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-300' : 'bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'}`}>
                      {cleared ? <FaCheck /> : <FaBox />}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{item.name}</h3>
                      <p className="mt-0.5 text-xs text-default-500">
                        {item.assetCode || 'No asset code'}{item.category ? ` · ${item.category}` : ''}{item.serialNumber ? ` · S/N ${item.serialNumber}` : ''}
                      </p>
                    </div>
                  </div>
                  <Chip size="sm" color={item.status === 'returned' ? 'success' : item.status === 'waived' ? 'warning' : 'default'} variant="flat" className="capitalize">
                    {item.status}
                  </Chip>
                </div>

                {cleared ? (
                  <div className="mt-3 rounded-xl bg-default-50 px-3 py-2 text-xs text-default-500">
                    {item.status === 'returned' ? `Returned${item.returnCondition ? ` in ${item.returnCondition} condition` : ''}` : 'Missing record waived'}
                    {item.clearedAt ? ` · ${formatIstDate(item.clearedAt)}` : ''}
                    {item.notes ? <span className="mt-1 block text-default-600">{item.notes}</span> : null}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
                    {!item.recordMissing && (
                      <label className="text-xs font-medium text-default-600">
                        Return condition
                        <select
                          value={draft.returnCondition}
                          onChange={(event) => updateDraft(assetId, 'returnCondition', event.target.value)}
                          className="mt-1.5 block h-10 w-full rounded-xl border border-default-300 bg-content1 px-3 text-sm outline-none focus:border-primary"
                        >
                          {RETURN_CONDITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                    )}
                    <label className={`text-xs font-medium text-default-600 ${item.recordMissing ? 'sm:col-span-2' : ''}`}>
                      {item.recordMissing ? 'Required waiver reason' : 'Return notes (optional)'}
                      <input
                        value={draft.notes}
                        onChange={(event) => updateDraft(assetId, 'notes', event.target.value)}
                        maxLength={1000}
                        placeholder={item.recordMissing ? 'Explain why this missing record can be cleared' : 'Accessories, damage, or handover notes'}
                        className="mt-1.5 block h-10 w-full rounded-xl border border-default-300 bg-content1 px-3 text-sm outline-none focus:border-primary"
                      />
                    </label>
                    <Button
                      color={item.recordMissing ? 'warning' : 'primary'}
                      startContent={processingAssetId !== assetId && <FaUndoAlt />}
                      isLoading={processingAssetId === assetId}
                      isDisabled={Boolean(processingAssetId) || (item.recordMissing && !draft.notes.trim())}
                      onPress={() => clearAsset(item, item.recordMissing ? 'waive' : 'return')}
                      className="min-w-32 justify-center"
                    >
                      {item.recordMissing ? 'Waive record' : 'Mark returned'}
                    </Button>
                  </div>
                )}
              </article>
            )
          })}
        </ModalBody>
        <ModalFooter className="border-t border-default-200">
          <Button color={summary.complete ? 'success' : 'primary'} variant="flat" onPress={onClose}>Done</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
