const fs = require('fs')
const read = name => fs.readFileSync(name, 'utf8')
test('board chat uses an explicit light MIRA surface and stronger chat-only beam', () => {
  for (const file of ['components/whiteboard/WhiteboardCanvas.js', 'components/whiteboard/MiraAgentSidebar.js']) {
    expect(read(file)).toContain('data-theme="light"')
    expect(read(file)).toContain('strength={0.95} theme="light"')
    expect(read(file)).toContain('sm:w-[460px]')
    expect(read(file)).toContain('mira-board-toolbar')
  }
  expect(read('components/MiraChatSidebar.js')).toContain('strength={0.95} theme="dark"')
  expect(read('components/ui/AIActivityBeam.js')).toContain('strength = 0.55')
  expect(read('app/globals.css')).toContain('color-scheme: light;')
})
test('search and both board panels render floating glass and activity beams', () => {
  for (const path of ['components/Header.js', 'components/whiteboard/MiraAgentSidebar.js', 'components/whiteboard/WhiteboardCanvas.js']) {
    const source = read(path)
    expect(source).toContain('ai-glass-panel fixed')
    expect(source).toContain('<AIActivityBeam active=')
  }
})
test('glass adapts to themes and the beam respects reduced motion', () => {
  expect(read('app/globals.css')).toContain('html.dark .ai-glass-panel')
  expect(read('components/whiteboard/MiraAgentSidebar.js')).not.toContain('Simulate progress phases')
  expect(read('components/ui/AIActivityBeam.js')).toContain('active && !reducedMotion')
})
test('board assistants use the shared smiley and a distinct scrollable conversation', () => {
  for (const file of ['components/whiteboard/WhiteboardCanvas.js', 'components/whiteboard/MiraAgentSidebar.js', 'components/ui/MiraLoadingOverlay.js']) {
    expect(read(file)).toContain("@/components/ui/MiraPet")
    expect(read(file)).not.toContain("@/components/ui/MiraSphere")
  }
  const canvas = read('components/whiteboard/WhiteboardCanvas.js')
  expect(canvas).toContain('aria-label="Canvas conversation"')
  expect(canvas).toContain('aria-label="Message MIRA about your canvas"')
  expect(canvas).toContain('Canvas tools</summary>')
  expect(canvas).toContain('mira-board-messages flex-1 min-h-0 overflow-y-auto')
})
test('agent composer remains outside the scrollable workspace', () => {
  const agent = read('components/whiteboard/MiraAgentSidebar.js')
  expect(agent).toContain('aria-label="Message MIRA Agent"')
  expect(agent.lastIndexOf('mira-board-composer')).toBeGreaterThan(agent.lastIndexOf('</AnimatePresence>'))
  expect(agent).toContain('aria-label="Close Agent Mode"')
})
