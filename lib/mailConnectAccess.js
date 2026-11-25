// Gmail can only be connected in a web browser (Google sign-in does not work inside
// the desktop app). Employees are otherwise blocked from the web dashboard, so this
// one page is allowed in the browser, only to connect the mailbox.

export const MAIL_CONNECT_URL = '/dashboard/mail?desktopConnect=1'
const LOGIN_NEXT = 'mail-connect'

/** True on the browser page that connects Gmail (opened from the desktop app or returning from Google). */
export function isMailConnectRoute(pathname, search) {
  if (pathname !== '/dashboard/mail') return false
  const query = new URLSearchParams(search || '')
  return query.get('desktopConnect') === '1' || query.has('connected') || query.has('error')
}

/** Login URL that brings the user back to the mail connect page after signing in. */
export function mailConnectLoginUrl(location) {
  return location && isMailConnectRoute(location.pathname, location.search) ? `/login?next=${LOGIN_NEXT}` : null
}

/** Where to go after login, when the login started from the mail connect page. */
export function mailConnectAfterLogin(search) {
  return new URLSearchParams(search || '').get('next') === LOGIN_NEXT ? MAIL_CONNECT_URL : null
}
