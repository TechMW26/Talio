import fs from 'fs'
import path from 'path'

describe('chat members panel layout', () => {
  const popupSource = fs.readFileSync(
    path.join(process.cwd(), 'components', 'chat', 'ChatPopup.js'),
    'utf8'
  )
  const sharedStyles = fs.readFileSync(
    path.join(process.cwd(), 'styles', 'ui-components.css'),
    'utf8'
  )

  test('constrains raw shared input icons without overriding explicit icon sizes', () => {
    expect(sharedStyles).toContain('.input-with-icon .input-icon:not([class*="w-"])')
    expect(sharedStyles).toContain('.input-with-icon .input-icon:not([class*="h-"])')
    expect(sharedStyles).toMatch(/max-width:\s*1\.25rem/)
    expect(sharedStyles).toMatch(/max-height:\s*1\.25rem/)
  })

  test('uses a bounded flex layout so the member list scrolls inside the popup', () => {
    expect(popupSource).toContain('flex min-h-0 flex-col overflow-hidden')
    expect(popupSource).toContain('min-h-0 flex-1 space-y-2 overflow-y-auto')
    expect(popupSource).not.toContain("maxHeight: 'calc(100% - 96px)'")
  })

  test('keeps restored or dragged popups inside the current viewport', () => {
    expect(popupSource).toContain('window.innerWidth - popupWidth - 20')
    expect(popupSource).toContain('window.innerHeight - popupHeight - 20')
    expect(popupSource).toContain('left: `${safePosition.x}px`')
    expect(popupSource).toContain('top: `${safePosition.y}px`')
  })
})
