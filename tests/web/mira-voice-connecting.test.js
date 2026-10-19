import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import MiraVoiceConnecting from '@/components/ui/MiraVoiceConnecting'

test('shows an accessible loading indicator and lets the user cancel', () => {
  const onCancel = jest.fn()
  const { rerender } = render(<MiraVoiceConnecting active onCancel={onCancel} />)
  expect(screen.getByRole('status')).toHaveTextContent('Mira is getting ready…')
  expect(screen.getByRole('status')).toHaveTextContent('Allow microphone access if prompted.')
  expect(screen.getByRole('img', { name: 'Mira thinking' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Preparing Mira voice' })).toHaveAttribute('aria-valuetext', 'Connecting to the live call')
  expect(document.querySelector('[data-mira-voice-preparing]')).toHaveClass('absolute', 'inset-0', 'backdrop-blur-xl')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel voice connection' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
  rerender(<MiraVoiceConnecting active={false} onCancel={onCancel} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('sidebar shows the loading overlay in chat and only the thinking face in PiP', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/MiraChatSidebar.js'), 'utf8')
  expect(source).toContain("const voiceConnecting = voice.state === 'loading'")
  expect(source).toContain('<MiraVoiceConnecting active={!pip && isOpen && voiceConnecting} onCancel={voice.stop} />')
  expect(source).toContain('<MiraFloatingFace state={voice.active ? voice.state : undefined}')
  expect(source.indexOf('<MiraVoiceConnecting active=')).toBeLessThan(source.indexOf("<div className={pip ? 'hidden' : 'contents'}>"))
  expect(source).not.toContain('MIRA ·')
  expect(source).toContain('processing={isThinking || voiceConnecting}')
  expect(source).toContain('suspended={isOpen || isThinking || voice.active || voiceConnecting}')
})
