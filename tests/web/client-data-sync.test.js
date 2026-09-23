import {
  getRefreshScopes,
  matchesApiRefreshScope,
  shouldForceFreshRequest,
  revalidateApiQueries,
} from '@/lib/clientDataSync'

describe('client data refresh scoping', () => {
  test('AI summary and draft generation do not invalidate their parent page', () => {
    expect(getRefreshScopes('POST /api/projects/summary-ai')).toEqual([])
    expect(getRefreshScopes('POST /api/mail/compose-ai')).toEqual([])
    expect(getRefreshScopes('POST /api/ai/generate-text')).toEqual([])
    expect(getRefreshScopes('POST /api/projects')).toEqual(['/api/projects'])
  })

  test('event-triggered revalidation retains cached data and never repeats on a timer', async () => {
    jest.useFakeTimers()
    const mutate = jest.fn().mockResolvedValue(undefined)
    revalidateApiQueries(mutate, ['/api/projects'])
    await jest.advanceTimersByTimeAsync(250)
    expect(mutate).toHaveBeenCalledWith(expect.any(Function), undefined, { revalidate: true, populateCache: false })
    await jest.advanceTimersByTimeAsync(120000)
    expect(mutate).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })
  test('keeps attendance events away from unrelated employee form data', () => {
    const scopes = getRefreshScopes('realtime:attendance-update')

    expect(scopes).toEqual(['/api/attendance', '/api/dashboard'])
    expect(matchesApiRefreshScope('/api/attendance/today', scopes)).toBe(true)
    expect(matchesApiRefreshScope('/api/dashboard/stats', scopes)).toBe(true)
    expect(matchesApiRefreshScope('/api/employees/employee-1', scopes)).toBe(false)
  })

  test('scopes successful mutations to their API domain', () => {
    const scopes = getRefreshScopes('PATCH /api/assets/asset-1?company=company-1')

    expect(scopes).toEqual(['/api/assets'])
    expect(matchesApiRefreshScope('/api/assets?limit=100', scopes)).toBe(true)
    expect(matchesApiRefreshScope('/api/employees', scopes)).toBe(false)
  })

  test('supports array SWR keys and rejects non-API keys', () => {
    expect(matchesApiRefreshScope(['/api/meetings/active', { tenant: 'one' }], ['/api/meetings'])).toBe(true)
    expect(matchesApiRefreshScope('dashboard-local-state', ['/api/dashboard'])).toBe(false)
  })

  test('only bypasses cache for the API scope changed by a mutation', () => {
    const now = Date.now()
    window.localStorage.setItem('talio:data-change', JSON.stringify({
      forceFreshUntil: now + 5000,
      scopes: ['/api/assets'],
    }))

    expect(shouldForceFreshRequest('/api/assets?limit=100')).toBe(true)
    expect(shouldForceFreshRequest('/api/employees')).toBe(false)
  })
})
