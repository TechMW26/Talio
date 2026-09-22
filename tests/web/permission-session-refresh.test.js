import { act, renderHook } from '@testing-library/react'
import usePermission from '@/hooks/usePermission'

describe('live role permissions', () => {
  beforeEach(() => localStorage.clear())
  test('reflects a role change without reloading the page', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'employee', roleId: 'custom', permissions: { assets: { canView: true, canCreate: false } } }))
    const { result } = renderHook(() => usePermission())
    expect(result.current.canCreate('assets')).toBe(false)
    act(() => {
      localStorage.setItem('user', JSON.stringify({ role: 'employee', roleId: 'custom', permissions: { assets: { canView: true, canCreate: true } } }))
      window.dispatchEvent(new Event('talio:session-updated'))
    })
    expect(result.current.canCreate('assets')).toBe(true)
    act(() => { localStorage.removeItem('user'); window.dispatchEvent(new Event('storage')) })
    expect(result.current.canCreate('assets')).toBe(false)
  })
  test('keeps legacy HR permissions but does not grant employee asset management', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'hr' }))
    const { result } = renderHook(() => usePermission())
    expect(result.current.canCreate('assets')).toBe(true)
    act(() => {
      localStorage.setItem('user', JSON.stringify({ role: 'employee' }))
      window.dispatchEvent(new Event('storage'))
    })
    expect(result.current.canCreate('assets')).toBe(false)
  })
})
