'use client'
import { useEffect, useRef, useState } from 'react'
import { FaTimes, FaPlus, FaTrash, FaArrowUp, FaArrowDown, FaLock, FaExclamationTriangle } from 'react-icons/fa'
import { NativeButton, NativeInput, NativeSelect, DialogSurface } from "@/components/ui/fernly/native"
import ModalPortal from '@/components/ui/ModalPortal'
import { STATUS_COLOR_KEYS, getStatusColorClasses } from '@/lib/taskStatusConfig'

export default function ManageTaskStatusesModal({ isOpen, onClose, statuses = [], onSave, saving = false, taskCounts = {} }) {
  const [rows, setRows] = useState([])
  const [confirmIndex, setConfirmIndex] = useState(null)
  const [blockedIndex, setBlockedIndex] = useState(null)
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) { setRows(statuses.map(s => ({ ...s }))); setConfirmIndex(null); setBlockedIndex(null) }
    wasOpenRef.current = isOpen
  }, [isOpen, statuses])
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

  return (
    <ModalPortal isOpen={isOpen}>
      <div className="modal-overlay">
        <DialogSurface role="dialog" aria-modal="true" aria-label="Manage Task Statuses" className="bg-white rounded-[30px] shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
          <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Manage Task Statuses</h3>
              <p className="text-xs text-gray-500 mt-0.5">Add, rename, recolor or reorder statuses.</p>
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
              return (
                <div key={row.key || `new-${i}`} className="flex items-center gap-2 p-2 rounded-xl border border-gray-200">
                  <div className="flex flex-col">
                    <NativeButton type="button" onClick={() => moveRow(i, -1)} disabled={saving || i === 0} aria-label={`Move ${row.label || "status"} up`} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><FaArrowUp size={10} /></NativeButton>
                    <NativeButton type="button" onClick={() => moveRow(i, 1)} disabled={saving || i === rows.length - 1} aria-label={`Move ${row.label || "status"} down`} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"><FaArrowDown size={10} /></NativeButton>
                  </div>
                  <span className={`inline-block h-3 w-3 rounded-full flex-shrink-0 ${c.dot}`} />
                  <NativeInput type="text" aria-label={`Status ${i + 1} name`} disabled={saving} value={row.label} onChange={(e) => updateRow(i, { label: e.target.value })} maxLength={60} placeholder="Status name" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                  <NativeSelect aria-label={`Status ${i + 1} color`} disabled={saving} value={row.color} onChange={(e) => updateRow(i, { color: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    {STATUS_COLOR_KEYS.map(cl => <option key={cl} value={cl}>{cl.charAt(0).toUpperCase() + cl.slice(1)}</option>)}
                  </NativeSelect>
                  {row.isSystem ? (
                    <span className="p-2 text-gray-400" title="Built-in - cannot be removed"><FaLock size={12} /></span>
                  ) : (
                    <NativeButton type="button" onClick={() => confirmRemove(i)} disabled={saving} aria-label={`Delete ${row.label || "status"}`}  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><FaTrash size={12} /></NativeButton>
                  )}
                </div>
              )
            })}

            <NativeButton type="button" onClick={addRow} disabled={saving || rows.length >= 96} className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50"><FaPlus size={11} /> Add status</NativeButton>
          </div>

          <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-2 flex-shrink-0">
            <NativeButton onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200">Cancel</NativeButton>
            <NativeButton onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save Statuses'}</NativeButton>
          </div>
        </DialogSurface>
      </div>
    </ModalPortal>
  )
}
