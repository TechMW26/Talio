const path = '/dashboard/mira/connect'
const codePattern = /^[a-f0-9]{5}-?[a-f0-9]{5}$/i
export function miraLinkLoginUrl(location) {
  if (location?.pathname !== path) return null
  const code = new URLSearchParams(location.search || '').get('user_code')
  const query = new URLSearchParams({ miraLink: '1' })
  if (code && codePattern.test(code)) query.set('miraCode', code.toUpperCase())
  return '/login?' + query
}
export function miraLinkAfterLogin(search) {
  const query = new URLSearchParams(search || '')
  if (query.get('miraLink') !== '1') return null
  const code = query.get('miraCode')
  if (code && !codePattern.test(code)) return null
  return path + (code ? '?user_code=' + encodeURIComponent(code.toUpperCase()) : '')
}
