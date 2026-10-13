import React from 'react'
import { render, screen } from '@testing-library/react'
import MiraVoiceCall from '@/components/ui/MiraVoiceCall'
import fs from 'node:fs'
import path from 'node:path'
jest.mock('@/components/ui/MiraPet', () => () => <span>Mira visual</span>)
test('voice panel contains status and an audio-reactive visual, not live captions', () => {
  const { rerender } = render(<MiraVoiceCall state="listening" />)
  expect(screen.getByRole('status')).toHaveTextContent('Listening')
  expect(screen.getByRole('region', { name: 'Mira voice call' })).toHaveStyle('--mira-voice-level: 0')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  const source = fs.readFileSync(path.join(process.cwd(), 'components/ui/MiraVoiceCall.js'), 'utf8')
  expect(source).toContain('compact ? 128 : 144')
  expect(source).not.toContain('scaleY')
  rerender(<MiraVoiceCall state="speaking" />)
  expect(screen.getByRole('status')).toHaveTextContent('Mira speaking')
  const sidebar = fs.readFileSync(path.join(process.cwd(), 'components/MiraChatSidebar.js'), 'utf8')
  expect(sidebar).toContain('voice.active ? (')
  expect(sidebar).toContain('voiceResults.map')
  expect(sidebar).toContain('!voice.active && <>')
  expect(sidebar).not.toContain('{voice.notice &&')
  expect(sidebar).not.toMatch(/ElevenLabs|Alisha/)
})
