'use client'
import { useEffect, useRef, useState } from 'react'
import { FaTimes, FaPlus, FaTrash, FaArrowUp, FaArrowDown, FaLock, FaExclamationTriangle } from 'react-icons/fa'
import { NativeButton, NativeInput, NativeSelect, DialogSurface } from "@/components/ui/fernly/native"
import ModalPortal from '@/components/ui/ModalPortal'
import { STATUS_COLOR_KEYS, getStatusColorClasses } from '@/lib/taskStatusConfig'

export default function ManageTaskStatusesModal({ isOpen, onClose, statuses = [], onSave, saving = false, taskCounts = {}, suggestedStatusName = '', suggestedStatusPosition = '', requestMode = false, onRequest = null, requesting = false }) {
  const [rows, setRows] = useState([])
  const [confirmIndex, setConfirmIndex] = useState(null)
  const [blockedIndex, setBlockedIndex] = useState(null)
  const [requestReason, setRequestReason] = useState('')
  const [showReasonField, setShowReasonField] = useState(false)
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const next = statuses.map(s => ({ ...s }))
      if (suggestedStatusName) {
        const newRow = { key: '', label: suggestedStatusName, color: 'blue', order: next.length, isSystem: false }
        // Insert before the requested position. If the position is "completed" or
        // unknown, keep it at the end (completed stays last by construction).
        if (suggestedStatusPosition && suggestedStatusPosition !== 'completed') {
          const index = next.findIndex(s => s.key === suggestedStatusPosition)
          if (index === -1) next.push(newRow)
          else next.splice(index, 0, newRow)
        } else {
          next.push(newRow)
        }
      }
      setRows(next); setConfirmIndex(null); setBlockedIndex(null); setRequestReason(''); setShowReasonField(false)
    }
    wasOpenRef.current = isOpen
  }, [isOpen, statuses, suggestedStatusName, suggestedStatusPosition])
  if (!isOpen) return null

  const updateRow = (i, patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const moveRow = (i, dir) => setRows(prev => {
    const next = [...prev]; const t = i + dir
    if (t < 0 || t >= next.length) return prev
    ;[next[i], next[t]] = [next[t], next[i]]
    return next
  })
  const confirmRemove = (i) => {
    const row = rows[i]
    if (row.key && (taskCounts[row.key] || 0) > 0) { setBlockedIndex(i); return }
    setConfirmIndex(i)
  }
  const cancelRemove = () => setConfirmIndex(null)
  const doRemove = (i) => { setRows(prev => prev.filter((_, idx) => idx !== i)); setConfirmIndex(null) }
  const addRow = () => setRows(prev => [...prev, { key: '', label: '', color: 'blue', order: prev.length, isSystem: false }])
  const handleSave = () => onSave(rows)
  const newRows = rows.map((r, i) => ({ row: r, index: i })).filter(({ row }) => !row.key)
  const handleRequest = () => {
    if (!onRequest) return
    if (newRows.length !== 1) return
    const { row, index } = newRows[0]
    const label = (row.label || '').trim()
    if (!label) return
    const position = rows[index + 1] ? rows[index + 1].key : null
    onRequest({ statusName: label, position, reason: requestReason.trim() })
  }
  const canSubmitRequest = requestReason.trim().length > 0 && newRows.length === 1 && Boolean((newRows[0]?.row.label || '').trim())

  return (
    <ModalPortal isOpen={isOpen}>
      <div className="modal-overlay">
        <DialogSurface role="dialog" aria-modal="true" aria-label={requestMode ? 'Request New Status' : 'Manage Board'} className="relative bg-white rounded-[30px] shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
          <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-xl font-bold text-gray-900">{requestMode ? 'Request New Status' : 'Manage Board'}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{requestMode ? 'Add a new status and place it on the board to send to the project owner.' : 'Add, rename, recolor or reorder statuses.'}</p>
            </div>
            <NativeButton onClick={onClose} disabled={saving} className="p-2 hover:bg-gray-100 rounded-lg"><FaTimes aria-label="Close" /></NativeButton>
          </div>

          <div className="p-4 space-y-2 overflow-y-auto flex-1">
            {rows.map((row, i) => {
              const c = getStatusColorClasses(row.color)
              if (blockedIndex === i) {
                const count = taskCounts[row.key] || 0
                return (
                  <div key={row.key || `blocked-${i}`} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start gap-3">
                      <span className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <FaExclamationTriangle className="text-amber-500" size={13} />
                      </span>
                      <p className="text-sm text-gray-700 leading-snug">
                        You can't delete <span className="font-semibold">"{row.label}"</span> because {count === 1 ? '1 task is' : `${count} tasks are`} using this status.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <NativeButton type="button" onClick={() => setBlockedIndex(null)} className="px-4 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-100">OK</NativeButton>
                    </div>
                  </div>
                )
              }
              if (confirmIndex === i) {
                return (
                  <div key={row.key || `new-${i}`} className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <div className="flex items-start gap-3">
                      <span className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <FaExclamationTriangle className="text-red-500" size={13} />
                      </span>
                      <p className="text-sm text-gray-700 leading-snug">
                        Delete <span className="font-semibold">"{row.label}"</span>? This can't be undone.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <NativeButton type="button" onClick={cancelRemove} className="px-4 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-100">Cancel</NativeButton>
                      <NativeButton type="button" onClick={() => doRemove(i)} disabled={saving} className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-700">Yes, Delete</NativeButton>
                    </div>
                  </div>
                )
              }
              const isNewRow = !row.key
              const readOnly = requestMode && Boolean(row.key)
              return (
                <div
                  key={row.key || `new-${i}`}
                  className={`flex items-center gap-2 p-2 rounded-xl border ${isNewRow ? 'border-primary-400 bg-primary-50 ring-2 ring-primary/30 animate-modal-enter' : 'border-gray-200'}`}
                >
                  <div className="flex flex-col">
                    <NativeButton type="button" onClick={() => moveRow(i, -1)} disabled={saving || i === 0 || readOnly} aria-label={`Move ${row.label || "status"} up`} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><FaArrowUp size={10} /></NativeButton>
                    <NativeButton type="button" onClick={() => moveRow(i, 1)} disabled={saving || i === rows.length - 1 || readOnly} aria-label={`Move ${row.label || "status"} down`} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><FaArrowDown size={10} /></NativeButton>
                  </div>
                  <span className={`inline-block h-3 w-3 rounded-full flex-shrink-0 ${c.dot}`} />
                  <NativeInput type="text" aria-label={`Status ${i + 1} name`} disabled={saving || readOnly} value={row.label} onChange={(e) => updateRow(i, { label: e.target.value })} maxLength={60} placeholder="Status name" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                  <NativeSelect aria-label={`Status ${i + 1} color`} disabled={saving || readOnly} value={row.color} onChange={(e) => updateRow(i, { color: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    {STATUS_COLOR_KEYS.map(cl => <option key={cl} value={cl}>{cl.charAt(0).toUpperCase() + cl.slice(1)}</option>)}
                  </NativeSelect>
                  {row.isSystem ? (
                    <span className="p-2 text-gray-400" title="Built-in - cannot be removed"><FaLock size={12} /></span>
                  ) : (
                    <NativeButton type="button" onClick={() => confirmRemove(i)} disabled={saving || readOnly} aria-label={`Delete ${row.label || "status"}`}  className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30"><FaTrash size={12} /></NativeButton>
                  )}
                  {isNewRow && (
                    <span className="ml-auto shrink-0 rounded-full bg-primary-600 text-white text-[10px] font-semibold px-2 py-0.5">New</span>
                  )}
                </div>
              )
            })}

            <NativeButton type="button" onClick={addRow} disabled={saving || requesting || rows.length >= 96 || (requestMode && newRows.length >= 1)} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"><FaPlus size={11} /> Add status</NativeButton>
          </div>

          <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-2 flex-shrink-0">
            <NativeButton onClick={onClose} disabled={saving || requesting} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200">Cancel</NativeButton>
            {requestMode ? (
              <NativeButton onClick={() => setShowReasonField(true)} disabled={newRows.length !== 1 || !Boolean((newRows[0]?.row.label || '').trim())} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60">
                Request New Status
              </NativeButton>
            ) : (
              <NativeButton onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save Statuses'}</NativeButton>
            )}
          </div>

          {requestMode && showReasonField && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
              <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowReasonField(false)} />
              <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 animate-modal-enter" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-base font-bold text-gray-900">Reason for this status</h4>
                  <NativeButton onClick={() => setShowReasonField(false)} disabled={requesting} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><FaTimes aria-label="Close" size={14} /></NativeButton>
                </div>
                <textarea
                  value={requestReason}
                  onChange={e => setRequestReason(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  autoFocus
                  placeholder="Why do you need this status?"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                <div className="flex items-center justify-end gap-2 mt-4">
                  <NativeButton onClick={() => setShowReasonField(false)} disabled={requesting} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200">Cancel</NativeButton>
                  <NativeButton onClick={handleRequest} disabled={requesting || !canSubmitRequest} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60">
                    {requesting ? 'Submitting…' : 'Submit Request'}
                  </NativeButton>
                </div>
              </div>
            </div>
          )}
        </DialogSurface>
      </div>
    </ModalPortal>
  )
}
