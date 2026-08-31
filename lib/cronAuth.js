import { timingSafeEqual } from 'crypto'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function normalizeSecret(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function secretsMatch(candidate, expected) {
  const candidateBuffer = Buffer.from(normalizeSecret(candidate))
  const expectedBuffer = Buffer.from(normalizeSecret(expected))

  if (candidateBuffer.length === 0 || candidateBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(candidateBuffer, expectedBuffer)
}

function getRequestHostname(request) {
  try {
    return new URL(request.url).hostname.toLowerCase()
  } catch {
    const host = request.headers?.get?.('host') || ''
    return host.split(':')[0].toLowerCase()
  }
}

/**
 * Validate requests to scheduled-job endpoints.
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Older Talio
 * schedulers used `x-cron-secret`, so both are accepted during migration.
 * A missing secret is always an error in production. Local development may
 * run without a secret only from a loopback hostname.
 */
export function authorizeCronRequest(request, options = {}) {
  const expectedSecret = normalizeSecret(options.secret ?? process.env.CRON_SECRET)
  const environment = options.environment ?? process.env.NODE_ENV
  const allowLocalWithoutSecret = options.allowLocalWithoutSecret ?? true
  const hostname = getRequestHostname(request)

  if (!expectedSecret) {
    const isLocalDevelopment =
      environment !== 'production'
      && allowLocalWithoutSecret
      && LOCAL_HOSTS.has(hostname)

    return isLocalDevelopment
      ? { authorized: true, source: 'local-development' }
      : {
          authorized: false,
          status: 500,
          code: 'CRON_SECRET_NOT_CONFIGURED',
          message: 'Cron secret is not configured',
        }
  }

  const authorization = request.headers?.get?.('authorization') || ''
  const bearerCandidate = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || ''
  const legacyCandidate = request.headers?.get?.('x-cron-secret') || ''

  if (secretsMatch(bearerCandidate, expectedSecret)) {
    return { authorized: true, source: 'bearer' }
  }

  if (secretsMatch(legacyCandidate, expectedSecret)) {
    return { authorized: true, source: 'legacy-header' }
  }

  return {
    authorized: false,
    status: 401,
    code: 'UNAUTHORIZED_CRON_REQUEST',
    message: 'Unauthorized',
  }
}

export function getCronAuthErrorResponse(request, options = {}) {
  const result = authorizeCronRequest(request, options)
  if (result.authorized) return null

  return Response.json(
    {
      success: false,
      code: result.code,
      message: result.message,
    },
    { status: result.status },
  )
}

