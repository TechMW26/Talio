export const DEFAULT_HALF_DAY_LIMIT = 12

export function normalizeHalfDayPolicy(policy = {}) {
  const parsedDefault = Number(policy.defaultAnnualLimit)
  const defaultAnnualLimit = Number.isFinite(parsedDefault)
    ? Math.max(0, parsedDefault)
    : DEFAULT_HALF_DAY_LIMIT
  const limitsByLevel = Array.from({ length: 9 }, (_, index) => {
    const level = index + 1
    const configured = (policy.limitsByLevel || []).find(item => Number(item.level) === level)
    return {
      level,
      maxHalfDays: Math.max(0, Number(configured?.maxHalfDays ?? defaultAnnualLimit)),
    }
  })

  return { defaultAnnualLimit, limitsByLevel }
}

export function getHalfDayLimit(policy, designationLevel) {
  const normalized = normalizeHalfDayPolicy(policy)
  const level = Math.min(9, Math.max(1, Number(designationLevel) || 1))
  return normalized.limitsByLevel.find(item => item.level === level)?.maxHalfDays
    ?? normalized.defaultAnnualLimit
}
