import crypto from 'crypto'

export function createMachineToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashMachineToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

export function verifyMachineToken(token, expectedHash) {
  if (!token || !expectedHash) return false
  const supplied = Buffer.from(hashMachineToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}

export function readMachineToken(request) {
  const authorization = request.headers.get('authorization') || ''
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }
  return request.headers.get('x-talio-machine-token')?.trim() || ''
}

