import { authorizeCronRequest, getCronAuthErrorResponse } from '@/lib/cronAuth'

function request(headers = {}, url = 'https://app.talio.in/api/cron/test') {
  return new Request(url, { headers })
}

describe('cron request authorization', () => {
  test('accepts Vercel bearer authorization', () => {
    expect(authorizeCronRequest(
      request({ authorization: 'Bearer correct-secret' }),
      { secret: 'correct-secret', environment: 'production' },
    )).toMatchObject({ authorized: true, source: 'bearer' })
  })

  test('accepts the legacy cron header during migration', () => {
    expect(authorizeCronRequest(
      request({ 'x-cron-secret': 'correct-secret' }),
      { secret: 'correct-secret', environment: 'production' },
    )).toMatchObject({ authorized: true, source: 'legacy-header' })
  })

  test('rejects missing and malformed credentials', () => {
    expect(authorizeCronRequest(
      request({ authorization: 'Basic correct-secret' }),
      { secret: 'correct-secret', environment: 'production' },
    )).toMatchObject({ authorized: false, status: 401 })

    expect(authorizeCronRequest(
      request({ authorization: 'Bearer wrong-secret' }),
      { secret: 'correct-secret', environment: 'production' },
    )).toMatchObject({ authorized: false, status: 401 })
  })

  test('fails closed when production has no cron secret', () => {
    expect(authorizeCronRequest(
      request(),
      { secret: '', environment: 'production' },
    )).toMatchObject({
      authorized: false,
      status: 500,
      code: 'CRON_SECRET_NOT_CONFIGURED',
    })
  })

  test('allows a secretless loopback request only in development', () => {
    expect(authorizeCronRequest(
      request({}, 'http://localhost:3000/api/cron/test'),
      { secret: '', environment: 'development' },
    )).toMatchObject({ authorized: true, source: 'local-development' })

    expect(authorizeCronRequest(
      request({}, 'https://preview.example.com/api/cron/test'),
      { secret: '', environment: 'development' },
    )).toMatchObject({ authorized: false, status: 500 })
  })

  test('returns a consistent error response contract', async () => {
    const response = getCronAuthErrorResponse(request(), {
      secret: 'correct-secret',
      environment: 'production',
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'UNAUTHORIZED_CRON_REQUEST',
      message: 'Unauthorized',
    })
  })
})

