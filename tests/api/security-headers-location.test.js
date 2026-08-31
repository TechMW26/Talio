import { getSecurityHeaders } from '@/lib/security/securityHeaders'

describe('location widget security policy', () => {
  test('allows only the OpenStreetMap services used by the dashboard widget', () => {
    const csp = getSecurityHeaders()['Content-Security-Policy']

    expect(csp).toContain('connect-src')
    expect(csp).toContain('https://nominatim.openstreetmap.org')
    expect(csp).toContain('frame-src')
    expect(csp).toContain('https://www.openstreetmap.org')
  })
})
