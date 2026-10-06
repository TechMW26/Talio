import { render, screen, fireEvent } from '@testing-library/react'
import LoginForm from '@/app/login/LoginForm'
jest.mock('@/app/login/login-form.css', () => ({}))

const props = () => ({ formData: { email: '', password: '' }, handleChange: jest.fn(), handleSubmit: jest.fn(e => e.preventDefault()), showPassword: false, setShowPassword: jest.fn(), loading: false, rememberMe: true, setRememberMe: jest.fn() })
beforeEach(() => { window.matchMedia = jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
test('uses real recovery link and preserves login submission', () => {
  const p = props()
  const { container } = render(<LoginForm {...p} />)
  expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/auth/forgot-password')
  expect(screen.queryByText(/Google/)).toBeNull()
  expect(container.querySelectorAll('img[src="/logo.png"]')).toHaveLength(1)
  expect(container.querySelector('.characters').getAttribute('viewBox')).toBe('0 0 248 183')
  fireEvent.submit(container.querySelector('form'))
  expect(p.handleSubmit).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
  expect(p.setShowPassword).toHaveBeenCalledWith(true)
})
test('characters protect password entry and busy state prevents repeat submission', () => {
  const p = props()
  const { container, rerender } = render(<LoginForm {...p} />)
  fireEvent.focus(screen.getByLabelText('Password'))
  expect(container.querySelector('.card').dataset.mood).toBe('hidden')
  rerender(<LoginForm {...p} loading showPassword />)
  expect(container.querySelector('.card').dataset.mood).toBe('revealed')
  expect(screen.getByRole('button', { name: 'Signing in…' }).disabled).toBe(true)
})
