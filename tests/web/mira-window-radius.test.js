import React from 'react'
import { act, render, screen } from '@testing-library/react'
import useMiraWindowRadius, { readMiraWindowRadius } from '@/hooks/useMiraWindowRadius'

function Panel({ surface = 'sidebar' }) {
  const radius = useMiraWindowRadius(true, surface)
  return <div data-testid="panel" style={{ borderRadius: radius }} />
}
test('Mira follows the actual sidebar radius across browser and desktop layout changes', async () => {
  const rail = document.createElement('aside')
  rail.className = 'talio-floating-rail'
  rail.style.borderTopLeftRadius = '22px'
  document.body.append(rail)
  try {
    render(<Panel />)
    expect(screen.getByTestId('panel').style.borderRadius).toBe('22px')
    rail.style.borderTopLeftRadius = '8px'
    await act(async () => { document.documentElement.setAttribute('data-desktop-platform', 'darwin') })
    expect(screen.getByTestId('panel').style.borderRadius).toBe('8px')
    rail.style.borderTopLeftRadius = '12px'
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByTestId('panel').style.borderRadius).toBe('12px')
    rail.style.borderTopLeftRadius = '0px'
    expect(readMiraWindowRadius()).toBe(0)
  } finally { rail.remove(); document.documentElement.removeAttribute('data-desktop-platform') }
})

test('internal macOS PiP uses the app window radius, not the inset sidebar radius', () => {
  const rail = document.createElement('aside')
  rail.className = 'talio-floating-rail'
  rail.style.borderTopLeftRadius = '8px'
  document.body.append(rail)
  document.documentElement.dataset.desktopPlatform = 'darwin'
  document.documentElement.style.setProperty('--dashboard-window-radius', '14px')
  try {
    const view = render(<Panel />)
    expect(screen.getByTestId('panel').style.borderRadius).toBe('8px')
    view.rerender(<Panel surface="pip" />)
    expect(screen.getByTestId('panel').style.borderRadius).toBe('14px')
    document.documentElement.style.setProperty('--dashboard-window-radius', '18px')
    act(() => window.dispatchEvent(new Event('resize')))
    expect(screen.getByTestId('panel').style.borderRadius).toBe('18px')
    view.rerender(<Panel />)
    expect(screen.getByTestId('panel').style.borderRadius).toBe('8px')
  } finally {
    rail.remove()
    document.documentElement.removeAttribute('data-desktop-platform')
    document.documentElement.style.removeProperty('--dashboard-window-radius')
  }
})

test('PiP keeps responsive browser geometry and a safe macOS fallback', () => {
  document.documentElement.style.setProperty('--dashboard-shell-radius', '18px')
  try {
    expect(readMiraWindowRadius(document, 'pip')).toBe(18)
    document.documentElement.dataset.desktopPlatform = 'darwin'
    expect(readMiraWindowRadius(document, 'pip')).toBe(14)
    document.documentElement.style.setProperty('--dashboard-window-radius', '0px')
    expect(readMiraWindowRadius(document, 'pip')).toBe(0)
  } finally {
    document.documentElement.removeAttribute('data-desktop-platform')
    document.documentElement.style.removeProperty('--dashboard-shell-radius')
    document.documentElement.style.removeProperty('--dashboard-window-radius')
  }
})
