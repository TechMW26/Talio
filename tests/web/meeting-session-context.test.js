import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let mockPathname = '/dashboard/meetings/room/room-123'
const mockPush = jest.fn(path => {
  mockPathname = path
})
const mockReplace = jest.fn(path => {
  mockPathname = path
})
const mockPrefetch = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: mockPrefetch,
  }),
}))

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockMeetingRoomSession({
    autoJoin,
    displayMode,
    onJoinedChange,
    onMinimizeToPip,
  }) {
    return (
      <div>
        <span data-testid="meeting-display-mode">{displayMode}</span>
        <span data-testid="meeting-auto-join">{autoJoin ? 'yes' : 'no'}</span>
        <button type="button" onClick={() => onJoinedChange(true)}>Join test meeting</button>
        <button type="button" onClick={onMinimizeToPip}>Minimise test meeting</button>
      </div>
    )
  },
}))

import { MeetingSessionProvider } from '@/contexts/MeetingSessionContext'

describe('MeetingSessionProvider', () => {
  beforeEach(() => {
    mockPathname = '/dashboard/meetings/room/room-123'
    mockPush.mockClear()
    mockReplace.mockClear()
    mockPrefetch.mockClear()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.localStorage.setItem('user', JSON.stringify({ _id: 'user-123' }))
  })

  it('keeps the joined session mounted as PiP while navigating back to Talio', () => {
    const view = render(
      <MeetingSessionProvider>
        <div>Dashboard content</div>
      </MeetingSessionProvider>
    )

    expect(screen.getByTestId('meeting-display-mode')).toHaveTextContent('full')
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Join test meeting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minimise test meeting' }))

    expect(mockReplace).toHaveBeenCalledWith('/dashboard')
    expect(screen.getByTestId('meeting-display-mode')).toHaveTextContent('full')

    view.rerender(
      <MeetingSessionProvider>
        <div>Dashboard content</div>
      </MeetingSessionProvider>
    )

    expect(screen.getByTestId('meeting-display-mode')).toHaveTextContent('expanded')
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })

  it('restores and automatically reconnects a joined PiP meeting after reload', async () => {
    const firstView = render(
      <MeetingSessionProvider>
        <div>Dashboard content</div>
      </MeetingSessionProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Join test meeting' }))

    await waitFor(() => {
      expect(window.sessionStorage.getItem('talio:active-meeting-session:v1')).toContain('room-123')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Minimise test meeting' }))
    firstView.unmount()

    render(
      <MeetingSessionProvider>
        <div>Dashboard content</div>
      </MeetingSessionProvider>
    )

    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('meeting-display-mode')).toHaveTextContent('expanded')
      expect(screen.getByTestId('meeting-auto-join')).toHaveTextContent('yes')
    })
  })

  it('keeps the active room when navigation targets a second meeting', async () => {
    const view = render(
      <MeetingSessionProvider>
        <div>Dashboard content</div>
      </MeetingSessionProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Join test meeting' }))
    mockPathname = '/dashboard/meetings/room/room-456'
    view.rerender(
      <MeetingSessionProvider>
        <div>Dashboard content</div>
      </MeetingSessionProvider>
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard/meetings/room/room-123')
    })
    expect(screen.getByTestId('meeting-display-mode')).toHaveTextContent('expanded')
  })
})
