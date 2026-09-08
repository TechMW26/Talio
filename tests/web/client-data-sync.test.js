import { getRefreshScopes, matchesApiRefreshScope } from '@/lib/clientDataSync'

describe('client data refresh scoping', () => {
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
})
