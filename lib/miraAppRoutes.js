import routes from './miraAppRoutes.generated.json'

const staticPaths = new Set(routes.filter(route => route.startsWith('/dashboard') && !route.includes('[') && !/\/(?:user-passwords|fcm-diagnostic)(?:\/|$)/.test(route)))
const settingsTabs = new Set(['company', 'recruitment', 'geofencing', 'attendance-machines', 'payroll', 'notifications'])
export function miraAppPath(value) {
  if (typeof value !== 'string' || value.length > 220 || !value.startsWith('/dashboard') || /[#\\%]/.test(value)) return null
  const [pathname, query, extra] = value.split('?')
  if (extra !== undefined || !staticPaths.has(pathname)) return null
  if (query === undefined) return pathname
  const params = new URLSearchParams(query)
  if ([...params].length !== 1) return null
  if (pathname === '/dashboard/settings' && settingsTabs.has(params.get('tab'))) return `${pathname}?tab=${params.get('tab')}`
  if (pathname === '/dashboard/projects/my-tasks' && /^[a-f\d]{24}$/i.test(params.get('task') || '')) return `${pathname}?task=${params.get('task')}`
  return null
}
