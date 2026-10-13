import React from 'react'
import { act, render, screen } from '@testing-library/react'
import MiraPet from '@/components/ui/MiraPet'
import { MIRA_ORB_STATES, miraOrbVoiceState, miraOrbRequestState, miraOrbActionState, publishMiraOrbState } from '@/lib/miraOrbState'

test('all nine states map to real voice, reasoning and action phases', () => {
  expect(new Set([
    miraOrbVoiceState('idle'), miraOrbVoiceState('loading'), miraOrbVoiceState('listening'), miraOrbVoiceState('speaking'), miraOrbVoiceState('working'),
    miraOrbRequestState('Solve this problem'), miraOrbActionState('lookup_people'), miraOrbActionState('create_project'), miraOrbActionState('generate_image'),
  ])).toEqual(new Set(MIRA_ORB_STATES))
  expect(miraOrbRequestState('Review these documents', { attachments: true })).toBe('weaving')
  expect(miraOrbRequestState('Find today’s attendance')).toBe('searching')
  expect(miraOrbActionState('send_message')).toBe('composing')
})
test('the shared orb follows live activity with tool-specific states and resets after the call', () => {
  render(<MiraPet size={20} />)
  act(() => publishMiraOrbState('voice', 'connecting'))
  expect(screen.getByRole('img', { name: 'Mira connecting' })).toBeInTheDocument()
  act(() => publishMiraOrbState('voice', 'working'))
  act(() => publishMiraOrbState('chat', 'searching'))
  expect(screen.getByRole('img', { name: 'Mira searching' })).toBeInTheDocument()
  act(() => publishMiraOrbState('chat', 'breathing'))
  act(() => publishMiraOrbState('voice', 'listening'))
  expect(screen.getByRole('img', { name: 'Mira listening' })).toBeInTheDocument()
  act(() => publishMiraOrbState('voice', 'breathing'))
  expect(screen.getByRole('img', { name: 'Mira breathing' })).toBeInTheDocument()
})
test.each(MIRA_ORB_STATES)('explicit state %s renders with caller theme/pause props', state => {
  const { container } = render(<MiraPet size={64} state={state} dark={false} paused speed={1.2} />)
  expect(container.querySelector('[data-mira-orb-state]')).toHaveAttribute('data-mira-orb-state', state)
  expect(screen.getByRole('img', { name: `Mira ${state}` })).toBeInTheDocument()
})
