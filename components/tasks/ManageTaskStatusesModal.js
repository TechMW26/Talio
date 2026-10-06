'use client'

import { useEffect, useState } from 'react'
import { FaTimes, FaPlus, FaTrash, FaArrowUp, FaArrowDown, FaLock } from 'react-icons/fa'
import ModalPortal from '@/components/ui/ModalPortal'
import { STATUS_COLOR_KEYS, getStatusColorClasses } from '@/lib/taskStatusConfig'

export default function ManageTaskStatusesModal({ isOpen, onClose, statuses = [], onSave, saving = false }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (isOpen) {
      setRows(statuses.map(s => ({ ...s })))
    }
  }, [isOpen, statuses])

  if (!isOpen) return null

  const updateRow = (index, patch) => {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const moveRow = (index, direction) => {
    setRows(prev => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const removeRow = (index) => {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  const addRow = () => {
    setRows(prev => [...prev, { key: '', label: '', color: 'blue', order: prev.length, isSystem: false }])
  }

  const handleSave = () => {
    const cleaned = rows.filter(r => r.label.trim())
    onSave(cleaned)
  }

  return (
    <ModalPortal isOpen={isOpen}>
      <div className="modal-overlay">
        <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
          <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Manage Task Statuses</h3>
              <p className="text-xs text-gray-500 mt-0.5">Add your own statuses, rename or recolor any of them, and reorder the board columns.</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <FaTimes />
            </button>
          </div>

          <div className="p-4 space-y-2 overflow-y-auto flex-1">
            {rows.map((row, index) => {
              const colorClasses = getStatusColorClasses(row.color)
              return (
                <div key={row.key || `new-${index}`} className="flex items-center gap-2 p-2 rounded-xl border border-gray-200">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveRow(index, -1)}
                      disabled={index === 0}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      title="Move up"
                    >
                      <FaArrowUp size={10} />
                    </button>
                    <button
                      type="button"cvcc
                      onClick={() => moveRow(index, 1)}
                      disabled={index === rows.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      title="Move down"
                    >
                      <FaArrowDown size={10} />
                    </button>
                  </div>

                  <span className={`inline-block h-3 w-3 rounded-full flex-shrink-0 ${colorClasses.dot}`} />

                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateRow(index, { label: e.target.value })}
                    maxLength={60}
                    placeholder="Status name"
                    className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />

                  <select
                    value={row.color}
                    onChange={(e) => updateRow(index, { color: e.target.value })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {STATUS_COLOR_KEYS.map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>

                  {row.isSystem ? (
                    <span className="p-2 text-gray-400" title="Built-in status - cannot be removed">
                      <FaLock size={12} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                      title="Remove status"
                    >
                      <FaTrash size={12} />
                    </button>
                  )}
                </div>
              )
            })}

            <button
              type="button"
              onClick={addRow}
              className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
            >
              <FaPlus size={11} /> Add status
            </button>
          </div>

          <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Statuses'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}