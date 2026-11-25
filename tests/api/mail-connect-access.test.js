import { MAIL_CONNECT_URL, isMailConnectRoute, mailConnectAfterLogin, mailConnectLoginUrl } from '@/lib/mailConnectAccess'

describe('browser access for connecting Gmail', () => {
  test('only the mail connect page is allowed, with a connect or Google-return flag', () => {
    expect(isMailConnectRoute('/dashboard/mail', '?desktopConnect=1')).toBe(true)
    expect(isMailConnectRoute('/dashboard/mail', '?connected=true')).toBe(true)
    expect(isMailConnectRoute('/dashboard/mail', '?error=expired')).toBe(true)
    expect(isMailConnectRoute('/dashboard/mail', '')).toBe(false)
    expect(isMailConnectRoute('/dashboard/mail', '?desktopConnect=0')).toBe(false)
    expect(isMailConnectRoute('/dashboard', '?desktopConnect=1')).toBe(false)
    expect(isMailConnectRoute('/dashboard/leave', '?connected=true')).toBe(false)
    expect(isMailConnectRoute('/dashboard/mail/inbox', '?desktopConnect=1')).toBe(false)
  })

  test('login started from the connect page returns to it, and nowhere else', () => {
    expect(mailConnectLoginUrl({ pathname: '/dashboard/mail', search: '?desktopConnect=1' })).toBe('/login?next=mail-connect')
    expect(mailConnectLoginUrl({ pathname: '/dashboard/leave', search: '' })).toBeNull()
    expect(mailConnectAfterLogin('?next=mail-connect')).toBe(MAIL_CONNECT_URL)
    expect(MAIL_CONNECT_URL).toBe('/dashboard/mail?desktopConnect=1')
    expect(mailConnectAfterLogin('?next=https://evil.example')).toBeNull()
    expect(mailConnectAfterLogin('')).toBeNull()
  })
})
