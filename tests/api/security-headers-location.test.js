import { getSecurityHeaders } from '@/lib/security/securityHeaders'

describe('location widget security policy', () => {
  test('allows only the OpenStreetMap services used by the dashboard widget', () => {
    const csp = getSecurityHeaders()['Content-Security-Policy']

    expect(csp).toContain('connect-src')
    expect(csp).toContain('https://nominatim.openstreetmap.org')
    expect(csp).toContain('frame-src')
    expect(csp).toContain('https://www.openstreetmap.org')
  })

  test('permits LiveKit HTTPS region discovery in both header implementations', async () => {
    const csp = getSecurityHeaders()['Content-Security-Policy']
    const rules = await require('../../next.config').headers()
    const nextCsp = rules.find((rule) => rule.source === '/:path*').headers.find((header) => header.key === 'Content-Security-Policy').value
    for (const policy of [csp, nextCsp]) {
      expect(policy.split('; ').find((value) => value.startsWith('connect-src '))).toContain('https://*.livekit.cloud')
    }
  })
})
