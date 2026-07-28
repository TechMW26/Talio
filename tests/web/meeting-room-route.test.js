import { render, screen } from '@testing-library/react'
import MeetingRoomLayout from '@/app/dashboard/meetings/room/[roomId]/layout'
import MeetingRoomRoute from '@/app/dashboard/meetings/room/[roomId]/page'

describe('meeting room route shell', () => {
  it('does not insert an empty viewport before the context-mounted room', () => {
    const { container } = render(
      <MeetingRoomLayout>
        <div data-testid="room-content">Room</div>
      </MeetingRoomLayout>
    )

    expect(screen.getByTestId('room-content')).toBeInTheDocument()
    expect(container.querySelector('.h-screen')).not.toBeInTheDocument()
  })

  it('shows a visible loading state while the meeting session initializes', () => {
    render(<MeetingRoomRoute />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading Talio Meet')
  })
})
