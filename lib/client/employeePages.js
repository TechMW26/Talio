// Collect every page without raising server limits or returning partial success.
// fetchPage retains the caller's authentication, timeout and error handling.
export async function collectEmployeePages(url, fetchPage) {
  const parsed = new URL(url, 'http://talio.local')
  parsed.searchParams.delete('all')
  parsed.searchParams.set('page', '1')
  let first
  const employees = new Map()
  for (let page = 1; ; page += 1) {
    parsed.searchParams.set('page', String(page))
    const result = await fetchPage(`${parsed.pathname}${parsed.search}`)
    if (!Array.isArray(result?.data)) throw new Error('Invalid employee list response')
    if (!first) first = result
    let added = 0
    for (const employee of result.data) {
      const id = String(employee._id || '')
      if (!id) throw new Error('Employee list returned an invalid identifier')
      if (!employees.has(id)) added += 1
      employees.set(id, employee)
    }
    const pagination = result.pagination || result.meta
    const more = pagination?.hasMore ?? (page < (pagination?.pages || 1))
    if (!more) break
    if (!added) throw new Error('Employee list pagination did not advance. Please retry.')
  }
  return { ...first, data: [...employees.values()], pagination: { page: 1, pages: 1, total: employees.size, hasMore: false } }
}

export function isCompleteEmployeeList(url) {
  if (typeof url !== 'string') return false
  const parsed = new URL(url, 'http://talio.local')
  return ['/api/employees', '/api/directory', '/api/employees/list'].includes(parsed.pathname) && parsed.searchParams.get('all') === 'true'
}

// Adapter for older imperative callers that consume Response.json().
export async function fetchCompleteEmployeeResponse(url, options) {
  const result = await collectEmployeePages(url, async pageUrl => {
    const response = await fetch(pageUrl, options)
    const body = await response.json()
    if (!response.ok || body.success === false) throw new Error(body.message || 'Unable to load employees')
    return body
  })
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}
