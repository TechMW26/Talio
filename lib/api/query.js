export function getPagination(searchParams, defaults = {}) {
  const defaultLimit = defaults.limit || 20
  const maxLimit = defaults.maxLimit || 100
  const pageValue = Number.parseInt(searchParams.get('page'), 10)
  const limitValue = Number.parseInt(searchParams.get('limit'), 10)
  const page = Math.max(1, Number.isFinite(pageValue) ? pageValue : 1)
  const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(limitValue) ? limitValue : defaultLimit))
  return { page, limit, skip: (page - 1) * limit }
}
