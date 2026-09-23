import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'

function Probe() {
  const theme = useTheme()
  return <button onClick={() => theme.setDarkModePreference('light')}>{theme.theme.name}:{String(theme.isDarkMode)}</button>
}
test('fixed black appearance ignores legacy saved preferences and switching calls', () => {
  localStorage.setItem('app-theme', 'purple')
  localStorage.setItem('app-dark-mode-pref', 'light')
  render(<ThemeProvider><Probe /></ThemeProvider>)
  expect(screen.getByText('Talio Black:true')).toBeInTheDocument()
  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement.style.getPropertyValue('--color-bg-main')).toBe('#090909')
  act(() => screen.getByRole('button').click())
  expect(screen.getByText('Talio Black:true')).toBeInTheDocument()
})
