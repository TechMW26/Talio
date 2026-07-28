import { fireEvent, render, screen } from '@testing-library/react'
import MeetingNotetakerPanel from '@/app/dashboard/meetings/components/MeetingNotetakerPanel'

describe('MeetingNotetakerPanel', () => {
  it('shows transcript history without the redundant Mira summary', () => {
    const { container } = render(
      <MeetingNotetakerPanel
        isOpen
        transcript={[]}
        onClose={jest.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'Transcript History' })).toBeInTheDocument()
    expect(screen.queryByText('Mira Live Transcription')).not.toBeInTheDocument()
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.queryByText('Detected Languages')).not.toBeInTheDocument()
    expect(screen.queryByText('Active Speakers')).not.toBeInTheDocument()
    expect(container.querySelector('aside')).toHaveClass('bg-white', 'dark:bg-slate-900')
  })

  it('keeps errors visible and exposes an accessible close action', () => {
    const onClose = jest.fn()

    render(
      <MeetingNotetakerPanel
        isOpen
        error="Transcription is temporarily unavailable."
        transcript={[]}
        onClose={onClose}
      />
    )

    expect(screen.getByText('Transcription is temporarily unavailable.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close transcript' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
