export function validateSettlement(input = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || Number.isNaN(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) throw new Error('A valid settlement date is required')
  const currency = String(input.currency || 'INR').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Use a three-letter currency code')
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) throw new Error('Add between 1 and 50 settlement components')
  let total = 0
  const items = input.items.map(item => {
    const label = String(item.label || '').trim().slice(0, 120)
    const amount = Number(item.amount)
    if (!label || !['earning', 'deduction'].includes(item.type) || !Number.isFinite(amount) || amount < 0 || amount > 1e9) throw new Error('Each component needs a label, type and non-negative amount')
    const minor = Math.round(amount * 100)
    total += item.type === 'deduction' ? -minor : minor
    return { label, type: item.type, amount: minor / 100 }
  })
  return { date: input.date, currency, items, netAmount: total / 100, notes: String(input.notes || '').trim().slice(0, 2000) }
}
