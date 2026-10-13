import React from 'react'
import { render, screen } from '@testing-library/react'
import { MIRA_AGENT_SYSTEM_PROMPT, MIRA_LIVE_VOICE_INSTRUCTIONS } from '@/lib/miraSystemPrompt'
import { miraOutputModeInstructions } from '@/lib/miraSpokenReply'
import { DEFAULT_MIRA_AGENT_VOICE_ID, miraAgentVoice, MIRA_VOICES } from '@/lib/miraVoices'
import MiraVoiceCall from '@/components/ui/MiraVoiceCall'

test('agent and brain share truthful live-call context without asserting raw audio analysis', () => {
  expect(MIRA_AGENT_SYSTEM_PROMPT).toContain(MIRA_LIVE_VOICE_INSTRUCTIONS)
  expect(miraOutputModeInstructions('voice')).toContain(MIRA_LIVE_VOICE_INSTRUCTIONS)
  expect(miraOutputModeInstructions('chat')).not.toContain(MIRA_LIVE_VOICE_INSTRUCTIONS)
  expect(MIRA_LIVE_VOICE_INSTRUCTIONS).toContain('spoken words reached Mira')
  expect(MIRA_LIVE_VOICE_INSTRUCTIONS).toContain('from a transcript alone')
})
test('live-call default is a validated Indian voice and does not replace saved preview voices', () => {
  expect(MIRA_VOICES.find(voice => voice.id === DEFAULT_MIRA_AGENT_VOICE_ID)).toMatchObject({ name: 'Alisha', accent: 'Indian' })
  expect(miraAgentVoice('invalid').voiceId).toBe(DEFAULT_MIRA_AGENT_VOICE_ID)
  expect(miraAgentVoice('komDQG4wp0wC5IDFwetv').voiceName).toContain('Indian')
  expect(miraAgentVoice(DEFAULT_MIRA_AGENT_VOICE_ID)).toMatchObject({ voiceId: DEFAULT_MIRA_AGENT_VOICE_ID, notice: '' })
})
test('compact voice is orb-only without branding, status, bars or call buttons', () => {
  const { rerender } = render(<MiraVoiceCall compact state="loading" />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  rerender(<MiraVoiceCall compact state="listening" />)
  expect(screen.queryByText(/Live call|Speak naturally|ElevenLabs|Alisha/)).not.toBeInTheDocument()
  expect(screen.getByRole('img').parentElement).toHaveStyle({ width: '128px', height: '128px' })
  expect(screen.queryByText('Listening')).not.toBeInTheDocument()
})
