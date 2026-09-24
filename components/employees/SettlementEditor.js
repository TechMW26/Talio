'use client'

import { useState } from 'react'
import { Button } from '@heroui/react'
import { validateSettlement } from '@/lib/hrms/settlement'

export default function SettlementEditor({ value, onSave, busy }) {
  const [draft, setDraft] = useState(value?.date ? value : {
    date: '', currency: 'INR', notes: '',
    items: ['Unpaid salary', 'Leave encashment', 'Reimbursements', 'Other approved earnings'].map(label => ({ label, type: 'earning', amount: 0 })),
  })
  const [error, setError] = useState('')
  const update = (index, patch) => setDraft(current => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) }))
  const field = 'rounded-lg border border-default-200 bg-transparent px-3 py-2 text-sm min-w-0'
  return <div className="mt-4 space-y-3 rounded-xl border border-default-200 p-4">
    <h4 className="font-semibold">Full & final settlement</h4>
    <p className="text-xs text-default-500">Enter approved amounts. Taxes, gratuity and notice recovery are not calculated automatically; add them under your applicable policy. Saving does not mark payment completed.</p>
    <div className="flex gap-2"><input aria-label="Settlement date" type="date" className={field} value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /><input aria-label="Currency" maxLength={3} className={`${field} w-24`} value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value })} /></div>
    {draft.items.map((item, index) => <div key={index} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <input aria-label={`Component ${index + 1}`} className={field} value={item.label} onChange={e => update(index, { label: e.target.value })} />
      <select aria-label={`Type ${index + 1}`} className={field} value={item.type} onChange={e => update(index, { type: e.target.value })}><option value="earning">Earning</option><option value="deduction">Deduction</option></select>
      <input aria-label={`Amount ${index + 1}`} className={field} type="number" min="0" step="0.01" value={item.amount} onChange={e => update(index, { amount: e.target.value })} />
      <Button size="sm" variant="light" onPress={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}>Remove</Button>
    </div>)}
    <Button size="sm" variant="flat" isDisabled={draft.items.length >= 50} onPress={() => setDraft({ ...draft, items: [...draft.items, { label: '', type: 'deduction', amount: 0 }] })}>Add component</Button>
    <textarea aria-label="Settlement notes" className={`${field} w-full`} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="Calculation basis and approval notes" />
    {value?.savedAt && <p className="text-sm">Saved net settlement: {value.currency} {Number(value.netAmount).toFixed(2)}</p>}
    {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    <Button color="primary" isLoading={busy} onPress={() => { try { const settlement = validateSettlement(draft); setError(''); onSave(settlement) } catch (e) { setError(e.message) } }}>Save settlement</Button>
  </div>
}
