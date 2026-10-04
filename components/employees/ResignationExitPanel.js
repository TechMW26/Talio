'use client'
import { useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import SettlementEditor from './SettlementEditor'
import OffboardingAssetChecklistModal from './OffboardingAssetChecklistModal'
import { downloadDocumentFile } from '@/lib/client/documentFile'

const button = 'rounded-xl border border-default-300 px-4 py-2 text-sm disabled:opacity-50'
export default function ResignationExitPanel({ record, onUpdated }) {
  const endpoint = `/api/resignations/${record._id}/exit`
  const { data, error, isLoading, mutate } = useAuthedSWR(endpoint, { refreshInterval: 60000, revalidateOnFocus: true })
  const mutation = useApiMutation({ invalidateKeys: [endpoint, '/api/resignations', '/api/employees'], timeout: 60000 })
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [confirmations, setConfirmations] = useState({})
  const [paymentReference, setReference] = useState('')
  const [message, setMessage] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const exit = data?.data
  const save = async input => {
    setMessage('')
    const result = await mutation.execute(endpoint, { ...input, version: exit.version })
    if (result?.success) { setMessage(result.message); await mutate(); await onUpdated?.() }
    return result
  }
  if (isLoading) return <p role="status">Loading exit checklist…</p>
  if (error || !exit) return <p role="alert">Could not load exit details. <button className={button} onClick={() => mutate()}>Retry</button></p>
  const completed = exit.status === 'completed'
  const emailStatus = exit.document?.emailDelivery?.status || 'not_sent'
  return <div className="space-y-4 rounded-xl bg-default-50 p-4">
    <h4 className="font-semibold">Full-and-final settlement &amp; exit</h4>
    <p className="text-sm">Asset clearance: {exit.assets?.cleared || 0} of {exit.assets?.total || 0} cleared. {completed ? 'Exit completed. Employee status: Resigned.' : 'HR finalises on or after the agreed last working date.'}</p>
    {mutation.error && <p role="alert" className="text-danger">{mutation.error} <button className={button} onClick={() => mutate()}>Refresh status</button></p>}
    {message && <p role="status">{message}</p>}
    {exit.canManage && !completed && <>
      {!exit.started ? <button className={button} disabled={mutation.isLoading} onClick={() => save({ action: 'start' })}>Start F&amp;F / offboarding</button> : <>
        <button className={button} onClick={() => setAssetsOpen(true)}>Review asset returns</button>
        <SettlementEditor key={exit.settlement?.savedAt || 'new'} value={exit.settlement} busy={mutation.isLoading} onSave={settlement => save({ action: 'save_settlement', settlement })} />
        <form className="space-y-3 border-t border-default-200 pt-4" onSubmit={e => { e.preventDefault(); save({ action: 'finalise', ...confirmations, paymentReference }) }}>
          <p className="text-sm">Finalising marks the employee Resigned, disables their Talio sign-in, saves a relieving/F&amp;F PDF and emails it to the employee. Talio does not transfer funds.</p>
          <label className="block text-sm">Payment / recovery reference (or zero-balance explanation)<input className="mt-1 w-full rounded-xl border border-default-300 bg-content1 p-3" required minLength={3} maxLength={200} value={paymentReference} onChange={e => setReference(e.target.value)} /></label>
          {Object.entries({ handoverConfirmed: 'Handover is complete.', accessConfirmed: 'Company access has been cleared for exit.', settlementConfirmed: 'The saved amounts and payment/recovery record have been verified by HR.' }).map(([key, label]) => <label key={key} className="flex gap-2 text-sm"><input type="checkbox" required checked={Boolean(confirmations[key])} onChange={e => setConfirmations({ ...confirmations, [key]: e.target.checked })} />{label}</label>)}
          <button className={`${button} bg-primary text-primary-foreground`} disabled={mutation.isLoading || !exit.settlement?.savedAt || !exit.assets?.complete}>{mutation.isLoading ? 'Saving…' : 'Finalise exit & send documents'}</button>
        </form>
      </>}
    </>}
    {!exit.canManage && exit.settlement && <div className="text-sm"><p>Settlement: {exit.settlement.currency} {exit.settlement.netAmount?.toFixed(2)}</p><ul>{exit.settlement.items.map((item, index) => <li key={index}>{item.label}: {item.type === 'deduction' ? '−' : '+'}{item.amount.toFixed(2)}</li>)}</ul></div>}
    {exit.document && <div className="space-y-2 text-sm">
      <button className={button} onClick={async () => { setDownloadError(''); try { await downloadDocumentFile({ fileName: exit.document.fileName, fileUrl: `/api/documents/${exit.document._id}/file` }) } catch (error) { setDownloadError(error.message) } }}>Download relieving &amp; F&amp;F PDF</button>
      <p>Email to {exit.document.emailDelivery?.recipient}: {emailStatus === 'sent' ? 'Accepted by mail provider' : emailStatus.replaceAll('_', ' ')}</p>
      {exit.canManage && ['not_sent', 'failed'].includes(emailStatus) && <button className={button} disabled={mutation.isLoading} onClick={() => save({ action: 'send_documents' })}>Send documents by email</button>}
      {['sending', 'unknown'].includes(emailStatus) && <p className="text-warning">Delivery is not confirmed. Check the mail provider before retrying to avoid a duplicate email. The PDF remains available to download.</p>}
      {downloadError && <p role="alert">{downloadError}</p>}
    </div>}
    <OffboardingAssetChecklistModal isOpen={assetsOpen} employeeId={exit.employeeId} onClose={() => setAssetsOpen(false)} onUpdated={() => mutate()} />
  </div>
}
