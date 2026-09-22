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

  it('renders every reaction as a local PNG with an accessible label', () => {
    const { container } = render(
      <div>
        {MEETING_REACTIONS.map(reaction => (
          <MeetingReactionIcon key={reaction.value} value={reaction.value} />
        ))}
      </div>
    )

    expect(container.querySelectorAll('img')).toHaveLength(MEETING_REACTIONS.length)
    for (const reaction of MEETING_REACTIONS) {
      expect(screen.getByRole('img', { name: reaction.label }).getAttribute('src')).toMatch(/^\/emojis\/twemoji\/[a-f0-9]+\.png$/)
    }
    expect(container.textContent).toBe('')
  })
})
