import React from 'react'
import { act, render, screen } from '@testing-library/react'
import useMiraWindowRadius, { readMiraWindowRadius } from '@/hooks/useMiraWindowRadius'

function Panel() {
  const radius = useMiraWindowRadius(true)
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
