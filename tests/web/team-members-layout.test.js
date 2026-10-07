import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TeamMembersPage from '@/app/dashboard/team/members/page'
import { useAuthedSWRInfinite as useAuthedSWR } from '@/hooks/useAuthedSWR'
import { getTeamChat } from '@/lib/client/teamChat'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
jest.mock('@/lib/client/teamChat', () => ({ getTeamChat: jest.fn() }))
jest.mock('@/contexts/ChatWidgetContext', () => ({ useChatWidget: jest.fn() }))
const openChat = jest.fn()

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, useAuthedSWRInfinite: jest.fn() }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }) => <a {...props}>{children}</a> }))
jest.mock('framer-motion', () => ({
  LayoutGroup: ({ children }) => <>{children}</>, useReducedMotion: () => true,
  motion: { span: ({ layoutId, transition, ...props }) => <span {...props} />, article: ({ layout, initial, animate, transition, ...props }) => <article {...props} /> },
}))
const mutate = jest.fn()
const metadata = { departments: [{ _id: 'd1', name: 'Engineering' }, { _id: 'd2', name: 'Design' }], teams: [{ _id: 't1', teamName: 'Platform', department: 'd1' }, { _id: 't2', teamName: 'Creative', department: 'd2' }] }
const member = { _id: 'e1', firstName: 'Asha', lastName: 'Singh', employeeCode: 'E1', email: 'asha@example.com', department: { name: 'Engineering' }, skills: ['React'] }
beforeEach(() => { jest.clearAllMocks(); useChatWidget.mockReturnValue({ openChat }); useAuthedSWR.mockImplementation(() => ({ data: [{ data: [member], meta: metadata }], size: 1, setSize: jest.fn(), mutate })) })
test('department restricts team choices and resets a selected team', () => {
  render(<TeamMembersPage />)
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd1' } })
  expect(screen.queryByRole('button', { name: 'Creative' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Platform' }))
  expect(useAuthedSWR.mock.calls.at(-1)[0](0)).toBe('/api/team/members?limit=24&department=d1&team=t1')
  fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd2' } })
  expect(screen.getByRole('button', { name: 'All teams' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Creative' })).toBeInTheDocument()
  expect(useAuthedSWR.mock.calls.at(-1)[0](0)).toBe('/api/team/members?limit=24&department=d2')
})
test('preserves profile/reviews and chat controls; searches unloaded members on the server', async () => {
  useAuthedSWR.mockReturnValue({ data: [{ data: [member, { _id: 'e2' }], meta: metadata }], size: 1, setSize: jest.fn(), mutate })
  render(<TeamMembersPage />)
  expect(screen.getByRole('link', { name: "View Asha Singh's profile and reviews" })).toHaveAttribute('href', '/dashboard/team/members/e1')
  expect(screen.getByRole('button', { name: 'Chat with Asha Singh' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'not present' } })
  await waitFor(() => expect(useAuthedSWR.mock.calls.at(-1)[0](0)).toContain('search=not+present'))
})
test('chat opens the existing window with the returned conversation', async () => {
  getTeamChat.mockResolvedValue({ _id: 'chat-1', participants: ['e1'] })
  render(<TeamMembersPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Chat with Asha Singh' }))
  expect(screen.getByRole('button', { name: 'Chat with Asha Singh' })).toBeDisabled()
  await waitFor(() => expect(openChat).toHaveBeenCalledWith({ _id: 'chat-1', participants: ['e1'] }))
  expect(getTeamChat).toHaveBeenCalledWith('e1')
})
test('failed chat can be retried without opening a broken window', async () => {
  getTeamChat.mockRejectedValue(new Error('Unable to open chat'))
  render(<TeamMembersPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Chat with Asha Singh' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to open chat')
  expect(openChat).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Chat with Asha Singh' })).toBeEnabled()
})
test('has loading and retry states', () => {
  useAuthedSWR.mockReturnValue({ isLoading: true, mutate })
  const { rerender } = render(<TeamMembersPage />)
  expect(screen.getByLabelText('Loading team members')).toHaveAttribute('aria-busy', 'true')
  useAuthedSWR.mockReturnValue({ error: new Error('offline'), mutate })
  rerender(<TeamMembersPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(mutate).toHaveBeenCalled()
})
test('load more follows the cursor, appends cards and preserves them on failure', () => {
  const setSize = jest.fn()
  const first = { data: [member], meta: metadata, pagination: { hasMore: true, nextCursor: 'next cursor' } }
  useAuthedSWR.mockReturnValue({ data: [first], size: 1, setSize, mutate })
  const { rerender } = render(<TeamMembersPage />)
  const getKey = useAuthedSWR.mock.calls.at(-1)[0]
  expect(getKey(1, first)).toBe('/api/team/members?limit=24&cursor=next%20cursor')
  expect(getKey(1, { pagination: { hasMore: false } })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  expect(setSize).toHaveBeenCalledWith(2)
  useAuthedSWR.mockReturnValue({ data: [first], size: 2, setSize, mutate, error: new Error('offline') })
  rerender(<TeamMembersPage />)
  expect(screen.getByRole('button', { name: 'Chat with Asha Singh' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading more' }))
  expect(mutate).toHaveBeenCalled()
  useAuthedSWR.mockReturnValue({ data: [first, { data: [{ _id: 'e2', firstName: 'Bina' }], pagination: { hasMore: false } }], size: 2, setSize, mutate })
  rerender(<TeamMembersPage />)
  expect(screen.getByText('2 members loaded')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
})
