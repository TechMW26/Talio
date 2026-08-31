import { generateSignature, verifySignature } from '@/lib/webhookDispatcher'

describe('webhook signature validation', () => {
  test('accepts a valid HMAC and safely rejects malformed lengths', () => {
    const payload = JSON.stringify({ event: 'employee.created' })
    const secret = 'tenant-webhook-secret'
    const signature = generateSignature(payload, secret)

    expect(verifySignature(payload, secret, signature)).toBe(true)
    expect(verifySignature(payload, secret, `${signature}00`)).toBe(false)
    expect(verifySignature(payload, secret, '')).toBe(false)
  })
})
