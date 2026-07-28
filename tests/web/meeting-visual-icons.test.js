import { render, screen } from '@testing-library/react'
import { HiOutlineMicrophone } from 'react-icons/hi2'
import {
  CutLineIcon,
  MEETING_REACTIONS,
  MeetingReactionIcon,
} from '@/components/meetings/MeetingVisualIcons'

describe('meeting visual icons', () => {
  it('draws a cut line over disabled meeting controls', () => {
    const { container } = render(
      <CutLineIcon isOff label="Microphone muted">
        <HiOutlineMicrophone />
      </CutLineIcon>
    )

    expect(screen.getByRole('img', { name: 'Microphone muted' })).toBeInTheDocument()
    expect(container.querySelector('.-rotate-45')).toBeInTheDocument()
  })

  it('renders every reaction as an icon without visible emoji text', () => {
    const { container } = render(
      <div>
        {MEETING_REACTIONS.map(reaction => (
          <MeetingReactionIcon key={reaction.value} value={reaction.value} />
        ))}
      </div>
    )

    expect(container.querySelectorAll('svg')).toHaveLength(MEETING_REACTIONS.length)
    expect(container.textContent).toBe('')
  })
})
