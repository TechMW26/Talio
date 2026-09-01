const ADDRESS_FIELDS = ['street', 'city', 'state', 'country', 'zipCode', 'postalCode', 'fullAddress']

export function normalizeEmployeeAddress(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value.trim().slice(0, 2000)
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Address must be text or a structured address')

  return Object.fromEntries(
    ADDRESS_FIELDS
      .filter((field) => value[field] != null && String(value[field]).trim())
      .map((field) => [field, String(value[field]).trim().slice(0, 500)]),
  )
}

export function formatEmployeeAddress(value) {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value !== 'object' || Array.isArray(value)) return ''
  if (String(value.fullAddress || '').trim()) return String(value.fullAddress).trim()

  return [value.street, value.city, value.state, value.country, value.zipCode || value.postalCode]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ')
}
