import { fireEvent, render, screen } from '@testing-library/react'

let mockPathname = '/dashboard/meetings/room/room-123'
const mockPush = jest.fn(path => {
  mockPathname = path
})

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockMeetingRoomSession({
    displayMode,
    onJoinedChange,
    onMinimizeToPip,
  }) {
    return (
      <div>
        <span data-testid="meeting-display-mode">{displayMode}</span>
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
  })

  it('keeps the joined session mounted as PiP while navigating back to Talio', () => {
    render(
      <MeetingSessionProvider>
        <div>Dashboard content</div>
      </MeetingSessionProvider>
    )

    expect(screen.getByTestId('meeting-display-mode')).toHaveTextContent('full')
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Join test meeting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minimise test meeting' }))

    expect(mockPush).toHaveBeenCalledWith('/dashboard')
    expect(screen.getByTestId('meeting-display-mode')).toHaveTextContent('expanded')
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
  })
})
