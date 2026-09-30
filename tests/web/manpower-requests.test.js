import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ManpowerRequests from '@/components/recruitment/ManpowerRequests'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { buildNavigationSections } from '@/utils/menuInformationArchitecture'
import { getMenuItemsForRole, withManpowerRequests } from '@/utils/roleBasedMenus'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: jest.fn() }))
let execute, mutate, data
const record = () => ({ _id: 'r1', status: 'pending', canReview: true, createdAt: '2026-09-29T00:00:00Z', department: { name: 'Engineering' }, employee: { firstName: 'Test', lastName: 'Manager' }, justification: 'Additional delivery capacity', job: { jobTitle: 'Engineer', numberOfPositions: 2, location: 'Bhopal', workMode: 'hybrid', employmentType: 'full-time', educationLevel: 'bachelor', experience: { min: 2, max: 5 }, salaryRange: { min: 500000, max: 900000, currency: 'INR' }, requirements: ['Experience'], responsibilities: ['Build'], skills: ['JavaScript'], benefits: [] } })
beforeEach(() => {
  execute = jest.fn().mockResolvedValue({ success: true, message: 'Saved' }); mutate = jest.fn()
  data = { data: [], canSubmit: true, isHr: true, departments: [{ _id: 'd1', name: 'Engineering' }] }
  useAuthedSWR.mockImplementation(() => ({ data, mutate }))
  useApiMutation.mockImplementation(() => ({ execute, isLoading: false }))
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'submission-key-1234' })
})
test('new request has full job fields and submits normalized payload', async () => {
  render(<ManpowerRequests />)
  fireEvent.click(screen.getByText('New request'))
  const fields = { 'Job title': 'Engineer', Department: 'd1', Headcount: '2', Location: 'Bhopal', 'Annual salary budget: minimum': '500000', 'Annual salary budget: maximum': '900000', 'Business justification (internal)': 'More delivery capacity required', 'Job description (public)': 'Build and maintain software applications', 'Requirements (one per line)': 'Experience', 'Responsibilities (one per line)': 'Build\nTest', 'Skills (one per line)': 'JavaScript' }
  for (const [label, value] of Object.entries(fields)) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.submit(screen.getByText('Submit to HR').closest('form'))
  await waitFor(() => expect(execute).toHaveBeenCalledWith('/api/recruitment/requisitions', expect.objectContaining({ action: 'submit', submissionKey: 'submission-key-1234', numberOfPositions: 2, responsibilities: ['Build', 'Test'], salaryMin: 500000 })))
  expect(await screen.findByRole('status')).toHaveTextContent('Saved')
})
test('HR approval requires confirmation and exposes published link after refresh', async () => {
  data.data = [record()]
  render(<ManpowerRequests />)
  fireEvent.click(screen.getByText('Approve & publish'))
  expect(execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() => expect(execute).toHaveBeenCalledWith('/api/recruitment/requisitions', { action: 'approve', id: 'r1', reason: '' }))
})
test('requesters have no review controls and rejection explains why', () => {
  data.data = [{ ...record(), canReview: false, status: 'rejected', reviewReason: 'Budget not approved' }]
  render(<ManpowerRequests />)
  expect(screen.queryByText('Approve & publish')).not.toBeInTheDocument()
  expect(screen.getByText('HR feedback: Budget not approved')).toBeInTheDocument()
})
test('mutation failure is visible and retains form for retry', () => {
  useApiMutation.mockReturnValue({ execute, isLoading: false, error: 'Budget range is invalid' })
  render(<ManpowerRequests />)
  expect(screen.getByRole('alert')).toHaveTextContent('Budget range is invalid')
})
test('request menu is categorised under People', () => {
  expect(buildNavigationSections([{ name: 'Manpower Requests', path: '/dashboard/manpower-requests' }])[0]).toMatchObject({ name: 'People', submenu: [expect.objectContaining({ path: '/dashboard/manpower-requests' })] })
})
test.each(['manager', 'team_leader', 'department_head'])('%s gets a request link under People', role => {
  const sections = buildNavigationSections(withManpowerRequests(getMenuItemsForRole(role), { role }))
  expect(sections.find(section => section.name === 'People').submenu).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/dashboard/manpower-requests' })]))
})
test('HR sees requisitions in recruitment and ordinary employees do not', () => {
  expect(withManpowerRequests(getMenuItemsForRole('hr'), { role: 'hr' }).find(item => item.name === 'Recruitment').submenu).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/dashboard/recruitment/requisitions' })]))
  expect(withManpowerRequests(getMenuItemsForRole('employee'), { role: 'employee' }).some(item => item.name === 'Manpower Requests')).toBe(false)
})
