export const HOLIDAY_TYPES = Object.freeze(['public', 'company'])
export const HOLIDAY_DAY_PORTIONS = Object.freeze(['full_day', 'first_half', 'second_half'])

// Restricted or optional holidays must never exempt unrelated employees.
export function isHolidayApplicable(holiday, employee) {
  if (!holiday || holiday.isActive === false || holiday.isOptional || holiday.isFloating) return false
  const id = value => String(value?._id || value || '')
  if (holiday.company && id(holiday.company) !== id(employee?.company)) return false
  if (holiday.applicableTo === 'specific-locations') {
    const location = String(employee?.workLocation || '').trim().toLowerCase()
    if (!location || !(holiday.locations || []).some(value => String(value).trim().toLowerCase() === location)) return false
  }
  const scope = holiday.applicableFor
  if (scope?.allEmployees === false) {
    if (scope.departments?.length && !scope.departments.map(id).includes(id(employee?.department))) return false
    if (scope.designations?.length && !scope.designations.map(id).includes(id(employee?.designation))) return false
    if (scope.employeeTypes?.length && !scope.employeeTypes.includes(employee?.employeeType || employee?.employmentType)) return false
  }
  return true
}
export const isFullDayHoliday = holiday => Boolean(holiday && (!holiday.dayPortion || holiday.dayPortion === 'full_day'))

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
  const dayPortion = String(payload.dayPortion || current.dayPortion || 'full_day').trim().toLowerCase()
  if (!HOLIDAY_DAY_PORTIONS.includes(dayPortion)) {
    throw new Error('Holiday duration must be full day, first half, or second half')
  }

  return {
    ...payload,
    name,
    date,
    year: date.getFullYear(),
    type,
    dayPortion,
    category: type === 'company' ? 'company_specific' : 'public',
    isOptional: false,
    isFloating: false,
  }
}
