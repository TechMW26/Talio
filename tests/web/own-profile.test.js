import { render, screen, fireEvent } from '@testing-library/react'
import ProfilePage from '@/app/dashboard/profile/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
jest.mock('next/dynamic', () => () => ({ employee }) => <div>Interactive employee ID <span>{employee.status === 'active' ? 'Active Employee' : employee.status}</span></div>)
jest.mock('@/utils/userHelper', () => ({ syncUserData: jest.fn(), broadcastUserUpdate: jest.fn() }))
jest.mock('@/components/AadhaarVerificationSection', () => () => <div>Identity verification</div>)
jest.mock('@/components/ActiveSessionsSection', () => () => <div>Active sessions</div>)
jest.mock('@/components/TiltWrapper', () => ({ children }) => children)
jest.mock('@/components/ui/fernly', () => ({
  Modal: () => null, ModalContent: () => null, ModalHeader: () => null,
  ModalBody: () => null, ModalFooter: () => null, Button: () => null, Skeleton: () => null,
}))

const profile = { success: true, data: {
  user: { _id: 'user-test' },
  employee: { _id: 'employee-test', firstName: 'Test', lastName: 'Person',
    email: 'test@example.com', status: 'active', phone: '1234567890',
    department: { name: 'Engineering' }, designation: { title: 'Engineer' } },
} }
beforeEach(() => {
  useAuthedSWR.mockImplementation((url) => ({ isLoading: false, mutate: jest.fn(),
    data: url === '/api/profile' ? profile : url.endsWith('/kri')
      ? { data: { responsibilities: [{ title: 'Build features', description: 'Deliver quality work' }] } }
      : { data: { isComplete: true } },
  }))
})
test('renders own identity, details and protected workflows together', () => {
  render(<ProfilePage />)
  expect(screen.getByRole('heading', { name: 'My profile' })).toBeTruthy()
  expect(screen.getByRole('complementary', { name: 'Your digital employee ID' })).toBeTruthy()
  expect(screen.getByRole('complementary', { name: 'Your digital employee ID' }).contains(screen.getByText('Active Employee'))).toBe(true)
  expect(screen.getByText('test@example.com')).toBeTruthy()
  expect(screen.getByText('Identity verification')).toBeTruthy()
  expect(screen.getByText('Active sessions')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Resignations & exits' }).getAttribute('href')).toBe('/dashboard/resignations?view=mine')
  expect(screen.queryByRole('button', { name: 'Update profile photo' })).toBeNull()
})
test('responsibilities remain visible alongside profile details and edit/cancel', () => {
  render(<ProfilePage />)
  expect(screen.queryByRole('button', { name: 'Key Responsibilities' })).toBeNull()
  expect(screen.getByRole('complementary', { name: 'Key responsibilities' })).toBeTruthy()
  expect(screen.getByText('Build features')).toBeTruthy()
  expect(screen.getByText('Personal Information')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit Profile' })[0])
  expect(screen.getAllByPlaceholderText('Enter phone number')[0].value).toBe('1234567890')
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancel', exact: true })[0])
  expect(screen.queryByPlaceholderText('Enter phone number')).toBeNull()
})
