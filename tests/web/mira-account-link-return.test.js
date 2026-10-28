import { miraLinkLoginUrl, miraLinkAfterLogin } from '@/lib/miraAccountLinkReturn'
test('preserves only the pairing code through sign-in', () => {
  const login = miraLinkLoginUrl(new URL('https://app.talio.in/dashboard/mira/connect?user_code=abcde-12345&returnTo=https://attacker.invalid'))
  expect(login).toBe('/login?miraLink=1&miraCode=ABCDE-12345')
  expect(miraLinkAfterLogin(new URL(login, 'https://app.talio.in').search)).toBe('/dashboard/mira/connect?user_code=ABCDE-12345')
})
test('ordinary logins and unrelated routes keep existing destinations', () => {
  expect(miraLinkLoginUrl(new URL('https://app.talio.in/dashboard/tasks'))).toBeNull()
  expect(miraLinkAfterLogin('?email=a%40example.test')).toBeNull()
  expect(miraLinkAfterLogin('?returnTo=https://attacker.invalid')).toBeNull()
})
test('connection management can return without a code; arbitrary redirect/code injection is rejected', () => {
  expect(miraLinkAfterLogin('?miraLink=1')).toBe('/dashboard/mira/connect')
  expect(miraLinkAfterLogin('?miraLink=1&miraCode=https://attacker.invalid')).toBeNull()
  expect(miraLinkLoginUrl(new URL('https://app.talio.in/dashboard/mira/connect?user_code=%3Cscript%3E'))).toBe('/login?miraLink=1')
})
