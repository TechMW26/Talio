jest.mock('@heroui/react', () => ({ Button: ({ children }) => children }))

import { shouldRestrictWebAccess } from '@/components/WebAccessRestriction'

const FLAG = 'NEXT_PUBLIC_ALLOW_WEB_DASHBOARD_IN_DEV'
const originalNodeEnv = process.env.NODE_ENV

beforeEach(() => {
  window.matchMedia = jest.fn(() => ({ matches: false }))
  localStorage.setItem('user', JSON.stringify({ role: 'employee', firstName: 'Asha' }))
})

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  delete process.env[FLAG]
  localStorage.clear()
})

test('non-admin users are still sent to the app download screen by default', () => {
  process.env.NODE_ENV = 'development'
  expect(shouldRestrictWebAccess()).toBe(true)
})

test('the dev flag lifts the web block while NODE_ENV=development', () => {
  process.env.NODE_ENV = 'development'
  process.env[FLAG] = 'true'
  expect(shouldRestrictWebAccess()).toBe(false)
})

test('production ignores the dev flag', () => {
  process.env.NODE_ENV = 'production'
  process.env[FLAG] = 'true'
  expect(shouldRestrictWebAccess()).toBe(true)
})

test('admins stay unrestricted regardless of the flag', () => {
  process.env.NODE_ENV = 'production'
  localStorage.setItem('user', JSON.stringify({ role: 'admin', firstName: 'Admin' }))
  expect(shouldRestrictWebAccess()).toBe(false)
})
