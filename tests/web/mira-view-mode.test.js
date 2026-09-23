import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MiraChatProvider, useMiraChat } from '@/contexts/MiraChatContext'
import { matchMiraViewMode } from '@/lib/miraViewMode'
jest.mock('@/lib/miraClientContext', () => ({ getMiraClientContext: () => ({}) }))

function Consumer() {
  const chat = useMiraChat()
  return <>
    <span data-testid="mode">{chat.viewMode}</span>
    <button onClick={chat.openChat}>Open</button>
    <button onClick={() => chat.sendMessage('Go to projects')}>Navigate</button>
    <button onClick={() => chat.sendMessage('Show chatbox')}>Restore</button>
    <button onClick={() => chat.sendMessage('Switch to full width view')}>Expand</button>
  </>
}
test('navigation persists PiP through sidebar remounts until an explicit view command', async () => {
  global.fetch = jest.fn(async url => ({ json: async () => url === '/api/ai/mira-chat'
    ? { success: true, response: { message: 'Opening projects.', action: { type: 'navigate', page: 'projects' } } }
    : { success: false }, ok: true }))
  const tree = key => <MiraChatProvider><Consumer key={key} /></MiraChatProvider>
  const view = render(tree('dashboard'))
  await act(async () => fireEvent.click(screen.getByText('Open')))
  await act(async () => fireEvent.click(screen.getByText('Navigate')))
  expect(screen.getByTestId('mode')).toHaveTextContent('pip')
  view.rerender(tree('projects'))
  expect(screen.getByTestId('mode')).toHaveTextContent('pip')
  await act(async () => fireEvent.click(screen.getByText('Restore')))
  expect(screen.getByTestId('mode')).toHaveTextContent('chat')
  await act(async () => fireEvent.click(screen.getByText('Expand')))
  expect(screen.getByTestId('mode')).toHaveTextContent('expanded')
  expect(fetch.mock.calls.filter(([url]) => url === '/api/ai/mira-chat')).toHaveLength(1)
})
test.each(['Do not open chatbox', 'Write about full width view', 'Open projects', 'Translate "show chatbox"', 'Open chat messages'])('does not confuse other requests with view commands: %s', text => {
  expect(matchMiraViewMode(text)).toBeNull()
})
test.each([['Mira, show chatbox', 'chat'], ['Go back to chat view', 'chat'], ['Open fullwidth view', 'expanded'], ['चैट खोलो', 'chat'], ['Minimize yourself', 'pip']])('matches explicit view command %s', (text, mode) => {
  expect(matchMiraViewMode(text)).toBe(mode)
})
