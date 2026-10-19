import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
const sign = data => {
  if (!process.env.JWT_SECRET) throw new Error('Missing signing secret')
  return createHmac('sha256', process.env.JWT_SECRET).update('mira-desktop-habit-v1:' + data).digest()
}
export function createHabitReceipt(scope, goal, generation = 0, now = Date.now()) {
  const data = Buffer.from(JSON.stringify({ scope, goal, generation, id: randomUUID(), expires: now + 15 * 60000 })).toString('base64url')
  return data + '.' + sign(data).toString('base64url')
}
export function verifyHabitReceipt(ticket, scope, now = Date.now()) {
  const parts = String(ticket).split('.')
  if (parts.length !== 2) throw new Error('Invalid receipt')
  const expected = sign(parts[0]), actual = Buffer.from(parts[1], 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid receipt')
  const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  if (value.scope !== scope || !Number.isFinite(value.expires) || value.expires <= now || value.expires > now + 15 * 60000 || typeof value.goal !== 'string' || value.goal.length > 3000 || typeof value.id !== 'string') throw new Error('Invalid receipt')
  return value
}
