export const EMPLOYEE_LIST_DEFAULT_LIMIT = 50
export const EMPLOYEE_LIST_MAX_LIMIT = 1000

export function clampEmployeeListLimit(value) {
  const parsed = Number.parseInt(value, 10)
  return Math.min(
    EMPLOYEE_LIST_MAX_LIMIT,
    Math.max(1, Number.isFinite(parsed) ? parsed : EMPLOYEE_LIST_DEFAULT_LIMIT),
  )
}
