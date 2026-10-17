import React from 'react'
import { render, screen } from '@testing-library/react'
import MiraPet from '@/components/ui/MiraPet'
import fs from 'fs'
import path from 'path'

test('reply avatar allows animation overscan while retaining its fade and collapse', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  const wrapper = css.match(/\.mira-reply-avatar\s*\{([^}]+)\}/)[1]
  expect(wrapper).toContain('overflow: visible')
  expect(wrapper).toContain('width: 0')
  expect(wrapper).toContain('opacity: 0')
  expect(wrapper).toContain('pointer-events: none')
  expect(wrapper).toContain('width 400ms ease')
  expect(css).toContain('.mira-reply-avatar[data-active="true"] { width: 28px; margin-right: 10px; opacity: 1; pointer-events: auto; }')
})

// Render the real package. Canvas painting is covered by browser verification;
// jsdom still checks the library's public DOM, sizing and state transitions.
test('Mira uses one transparent robot canvas across activity changes', () => {
  const { rerender } = render(<MiraPet size={32} />)
  const avatar = screen.getByRole('img', { name: 'Mira idle' })
  const canvas = avatar.querySelector('canvas')
  expect(canvas).not.toBeNull()
  expect(avatar).not.toHaveAttribute('data-bot-avatar')
  expect(avatar.parentElement).toHaveAttribute('data-mira-orb-state', 'breathing')
  expect(avatar.parentElement).toHaveStyle({ width: '32px', height: '32px' })
  expect(avatar.parentElement).toHaveStyle({ background: 'transparent' })
  expect(avatar.parentElement.style.boxShadow).toBe('')
  rerender(<MiraPet size={64} isThinking />)
  expect(screen.getByRole('img', { name: 'Mira thinking' }).parentElement).toHaveAttribute('data-mira-orb-state', 'solving')
  expect(avatar.querySelector('canvas')).toBe(canvas)
  expect(avatar.parentElement).toHaveStyle({ width: '64px', height: '64px' })
})
