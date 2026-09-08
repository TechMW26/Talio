export const HOLIDAY_TYPES = Object.freeze(['public', 'company'])

export function normalizeHolidayType(value) {
  const normalized = String(value || 'public').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (normalized === 'public-holiday') return 'public'
  if (normalized === 'company-holiday' || normalized === 'company-specific') return 'company'
  return HOLIDAY_TYPES.includes(normalized) ? normalized : null
}

export function sanitizeHolidayPayload(payload = {}, current = {}) {
  const type = normalizeHolidayType(payload.type || payload.category || current.type || current.category)
  if (!type) throw new Error('Holiday type must be Public Holiday or Company Holiday')

  const name = String(payload.name ?? current.name ?? '').trim()
  const date = new Date(payload.date || current.date)
  if (!name) throw new Error('Holiday name is required')
  if (Number.isNaN(date.getTime())) throw new Error('A valid holiday date is required')

  return {
    ...payload,
    name,
    date,
    year: date.getFullYear(),
    type,
    category: type === 'company' ? 'company_specific' : 'public',
    isOptional: false,
    isFloating: false,
  }
}
