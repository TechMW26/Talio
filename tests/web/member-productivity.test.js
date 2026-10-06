import { render, screen, fireEvent } from '@testing-library/react'
import MemberProductivity, { ProtectedScreenshot } from '@/app/dashboard/team/members/[id]/MemberProductivity'
import useAuthedSWR from '@/hooks/useAuthedSWR'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/components/productivity/AnalyzedComposite', () => ({ __esModule: true, default: ({ userId, date }) => <div>Composite {userId} {date}</div> }))
jest.mock('@/components/ui/HeroModal', () => ({ __esModule: true, default: () => null }))
jest.mock('@heroui/react', () => ({ ModalBody: () => null, ModalContent: () => null }))

test('never falls back to viewer screenshots if selected employee has no account', () => {
  useAuthedSWR.mockReturnValue({})
  render(<MemberProductivity employee={{ _id: 'e1' }} date="2026-10-01" />)
  expect(useAuthedSWR.mock.calls.every(([key]) => key === null)).toBe(true)
  expect(screen.getByText(/No linked account/)).toBeInTheDocument()
})
test('screenshots are scoped by employee account and date and paginated by cursor', () => {
  useAuthedSWR.mockImplementation(key => key?.includes('/screenshots?') ? { data: { screenshots: [], pagination: { total: 24, nextCursor: 'page-two' } }, mutate: jest.fn() } : { data: { data: [] }, mutate: jest.fn() })
  render(<MemberProductivity employee={{ _id: 'e1', userId: 'u1' }} date="2026-10-01" />)
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/activity/screenshots?userId=u1&date=2026-10-01&limit=12', { keepPreviousData: false })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/activity/screenshots?userId=u1&date=2026-10-01&limit=12&cursor=page-two', { keepPreviousData: false })
  expect(screen.getByText('Page 2')).toBeInTheDocument()
})
test('denied screenshot access is explicit and does not render the composite viewer', () => {
  useAuthedSWR.mockReturnValue({ error: { status: 403 }, mutate: jest.fn() })
  render(<MemberProductivity employee={{ _id: 'e1', userId: 'u1' }} date="2026-10-01" />)
  expect(screen.getByText(/permission to view this employee’s screenshots/)).toBeInTheDocument()
  expect(screen.queryByText(/Composite/)).not.toBeInTheDocument()
})
test('screenshot images use authenticated requests and revoke their temporary URL', async () => {
  const oldFetch = global.fetch, oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL
  URL.createObjectURL = jest.fn(() => 'blob:test-screenshot')
  URL.revokeObjectURL = jest.fn()
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) })
  localStorage.setItem('token', 'test-session')
  try {
    const { unmount } = render(<ProtectedScreenshot shot={{ id: 's1', formattedTime: '10:00' }} />)
    expect(await screen.findByRole('img', { name: 'Screenshot captured 10:00' })).toHaveAttribute('src', 'blob:test-screenshot')
    expect(global.fetch).toHaveBeenCalledWith('/api/activity/screenshot?id=s1', expect.objectContaining({ headers: { Authorization: 'Bearer test-session' }, signal: expect.any(AbortSignal) }))
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-screenshot')
  } finally { global.fetch = oldFetch; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; localStorage.removeItem('token') }
})
