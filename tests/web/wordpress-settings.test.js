import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WordPressRecruitmentSettings from '@/components/settings/WordPressRecruitmentSettings'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@heroui/react', () => ({
  Button: ({ children, onPress, isDisabled, isLoading }) => <button disabled={isDisabled || isLoading} onClick={onPress}>{children}</button>,
  Input: ({ label, value, onValueChange, isDisabled, isReadOnly, type }) => <label>{label}<input type={type} value={value} disabled={isDisabled} readOnly={isReadOnly} onChange={event => onValueChange?.(event.target.value)} /></label>,
  Select: ({ label, children, selectedKeys, onSelectionChange, isDisabled }) => <label>{label}<select disabled={isDisabled} value={selectedKeys[0] || ''} onChange={event => onSelectionChange(new Set([event.target.value]))}><option value="">Choose</option>{React.Children.map(children, child => <option value={String(child.key).replace(/^\.\$/, '')}>{child.props.children}</option>)}</select></label>,
  SelectItem: ({ children }) => <>{children}</>,
}))
let status, mutate
beforeEach(() => {
  status = { configured: false }; mutate = jest.fn()
  useAuthedSWR.mockImplementation(key => key === '/api/departments' ? { data: { data: [{ _id: 'department1', name: 'Engineering' }] } } : { data: { data: status }, mutate })
  global.fetch = jest.fn(); window.confirm = jest.fn(() => true)
  localStorage.setItem('token', 'test-user-token')
})

test('requires department, creates a scoped connection and shows the credential only after success', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { token: 'one-time-secret' } }) })
  render(<WordPressRecruitmentSettings />)
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/recruitment/wordpress', expect.objectContaining({ refreshInterval: 0, revalidateOnFocus: true }))
  expect(screen.getByRole('button', { name: 'Create connection' })).toBeDisabled()
  expect(screen.queryByLabelText('One-time connection token')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Default department for website jobs'), { target: { value: 'department1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create connection' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: 'connect', defaultDepartment: 'department1' })
  expect(await screen.findByLabelText('One-time connection token')).toHaveAttribute('type', 'password')
  expect(mutate).toHaveBeenCalled()
})

test('rotation can be cancelled and failed saves show an error without a token', async () => {
  status = { configured: true, enabled: true, siteUrl: 'https://careers.test', defaultDepartment: 'department1', endpointPath: '/api/integrations/wordpress/test' }
  window.confirm.mockReturnValueOnce(false)
  render(<WordPressRecruitmentSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Rotate token / reconnect' }))
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Not allowed' }) })
  fireEvent.click(screen.getByRole('button', { name: 'Rotate token / reconnect' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Not allowed')
  expect(screen.queryByLabelText('One-time connection token')).not.toBeInTheDocument()
})

test('existing settings do not expose stored credentials and can disable the connection', async () => {
  status = { configured: true, enabled: true, siteUrl: 'https://careers.test', defaultDepartment: 'department1', endpointPath: '/api/integrations/wordpress/test' }
  fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { enabled: false } }) })
  render(<WordPressRecruitmentSettings />)
  expect(screen.getByLabelText('WordPress website URL')).toBeDisabled()
  expect(screen.queryByLabelText('One-time connection token')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Disable connection' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Connection disabled')
})
