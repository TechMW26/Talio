import React from 'react'
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import MiraChatSidebar from '@/components/MiraChatSidebar'

const mockStop = jest.fn()
const mockStart = jest.fn()
const mockPush = jest.fn()
const mockOpenWidget = jest.fn()
const mockGenerate = jest.fn()
jest.mock('@/lib/miraDirectVoiceClient', () => ({ generateMiraDirectVoice: (...args) => mockGenerate(...args) }))
jest.mock('@/contexts/ChatWidgetContext', () => ({ useChatWidget: () => ({ openWidget: mockOpenWidget }) }))
const mockCloseChat = jest.fn()
jest.mock('@/lib/miraSpeechPlayback', () => ({ createMiraSpeechPlayback: () => ({ close: jest.fn(), cancel: jest.fn(), speak: jest.fn() }) }))
let mockOpen = true
let mockMessages = []
let mockThinking = false
jest.mock('@/components/ui/AIActivityBeam', () => ({ __esModule: true, default: ({ active }) => <div data-testid="activity-edge" data-active={active} /> }))
let mockBeamProps
jest.mock('voice-glow', () => ({
  VoiceBeam: (props) => {
    mockBeamProps = props
    const { children, style, className, role, 'aria-label': label } = props
    return <div style={style} className={className} role={role} aria-label={label}>{children}</div>
  },
}))
jest.mock('@/lib/miraWakeWord', () => ({ startMiraLocalRecognition: (...args) => mockStart(...args), storeMiraVoiceProfile: jest.fn(), isMiraWakeResult: jest.fn() }))
jest.mock('@/lib/miraConversationRecognition', () => ({ startMiraConversationRecognition: (...args) => mockStart(...args) }))
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), usePathname: () => '/dashboard' }))
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ isDarkMode: true, theme: { primary: { 50:'#141414', 100:'#222222', 200:'#333333', 300:'#777777', 400:'#888888', 500:'#aaaaaa', 600:'#bbbbbb', 700:'#cccccc', 900:'#eeeeee' } } }) }))
jest.mock('@/contexts/MiraChatContext', () => ({ useMiraChat: () => {
  const [viewMode, setViewMode] = require('react').useState('chat')
  return ({
  viewMode, setViewMode,
  isOpen: mockOpen, closeChat: mockCloseChat, messages: mockMessages, sendMessage: jest.fn(), isThinking: mockThinking,
  clearHistory: jest.fn(), tokens: { tokensRemaining: 100, tokenLimit: 100 }, sessions: [],
  showHistory: false, toggleHistory: jest.fn(), startNewChat: jest.fn(),
}) } }))

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, voiceId: 'voice', bridgeCredential: 'scoped' }) }))
  jest.spyOn(document, 'hasFocus').mockReturnValue(true)
  mockBeamProps = null
  mockOpen = true
  mockMessages = []
  mockThinking = false
  mockStart.mockReset()
  mockStop.mockReset()
  mockPush.mockReset()
  mockCloseChat.mockReset()
  mockGenerate.mockReset()
  window.speechSynthesis = { getVoices: () => [], cancel: jest.fn() }
  window.SpeechSynthesisUtterance = function () {}
  Element.prototype.scrollIntoView = jest.fn()
  HTMLMediaElement.prototype.pause = jest.fn()
})
test('direct voice keeps the orb without live user or assistant transcripts', async () => {
  let recognition
  mockStart.mockImplementation(async callbacks => { recognition = callbacks; return { stop: mockStop } })
  mockGenerate.mockImplementation(async ({ onText }) => { onText('[warm] I can hear you.'); return '[warm] I can hear you.' })
  render(<MiraChatSidebar />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start voice conversation' })) })
  act(() => recognition.onPartial('Can you hear'))
  expect(screen.queryByLabelText('Your live transcript')).toBeNull()
  await act(async () => recognition.onResult({ text: 'Can you hear me?' }))
  expect(screen.queryByRole('log', { name: 'Voice transcript' })).toBeNull()
  expect(screen.queryByText('Can you hear me?')).toBeNull()
  expect(screen.queryByText('I can hear you.')).toBeNull()
  expect(screen.getByLabelText('MIRA activity')).toBeInTheDocument()
  expect(global.fetch.mock.calls.some(([url]) => url.includes('mira-agent/session'))).toBe(false)
})
test('voice beam reacts strongly and quickly without lowering the noise gate', () => {
  const { rerender } = render(<MiraChatSidebar />)
  expect(mockBeamProps.borderRadius).toBe(22)
  expect(screen.getByRole('dialog', { name: 'MIRA assistant' }).style.borderRadius).toBe('22px')
  expect(mockBeamProps).toEqual(expect.objectContaining({ sensitivity: 5.4, threshold: 0.015, attack: 0.12, release: 0.42, reach: 1.9, idle: 0.14, active: false, paused: true }))
  mockOpen = false
  rerender(<MiraChatSidebar />)
  expect(mockBeamProps.active).toBe(false)
  expect(mockBeamProps.paused).toBe(true)
})

test('search-style edge runs during thinking and streaming, but not idle or closed', () => {
  const { rerender } = render(<MiraChatSidebar />)
  expect(screen.queryByTestId('activity-edge')).toBeNull()
  mockThinking = true
  rerender(<MiraChatSidebar />)
  expect(screen.getByTestId('activity-edge')).toHaveAttribute('data-active', 'true')
  mockThinking = false
  mockMessages = [{ id: 'stream', role: 'assistant', content: 'Hello', streaming: true }]
  rerender(<MiraChatSidebar />)
  expect(screen.getByTestId('activity-edge')).toBeInTheDocument()
  mockOpen = false
  rerender(<MiraChatSidebar />)
  expect(screen.queryByTestId('activity-edge')).toBeNull()
  mockOpen = true
  mockMessages = [{ id: 'stream', role: 'assistant', content: 'Hello', streaming: false }]
  rerender(<MiraChatSidebar />)
  expect(screen.queryByTestId('activity-edge')).toBeNull()
})

test('user bubbles hide internal reply context from restored messages', async () => {
  mockMessages = [{ id: 1, role: 'user', content: 'Replying to this MIRA response:\n<quoted-response>\nHidden previous answer\n</quoted-response>\n\nBaat chaat' }]
  render(<MiraChatSidebar />)
  await waitFor(() => expect(screen.getByText('Baat chaat')).toBeVisible())
  expect(screen.queryByText(/Replying to this MIRA response/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Hidden previous answer/)).not.toBeInTheDocument()
})

test('resolved project navigation opens the record and stays minimized', () => {
  render(<MiraChatSidebar />)
  const id = '507f1f77bcf86cd799439011'
  act(() => window.dispatchEvent(new CustomEvent('mira:navigate', { detail: { page: 'projects', id } })))
  expect(mockPush).toHaveBeenCalledWith(`/dashboard/projects/${id}`)
  expect(screen.getByLabelText('Restore MIRA chat')).toBeInTheDocument()
  expect(screen.queryByText('MIRA · Opening projects')).not.toBeInTheDocument()
  expect(screen.getByLabelText('MIRA activity')).toBeInTheDocument()
})
test('chat toolbar is unbranded while keeping history, new chat and window controls', () => {
  render(<MiraChatSidebar />)
  const toolbar = within(screen.getByRole('toolbar', { name: 'Chat controls' }))
  expect(toolbar.queryByRole('img')).not.toBeInTheDocument()
  expect(toolbar.queryByText('MIRA')).not.toBeInTheDocument()
  expect(toolbar.queryByText('Your AI Assistant')).not.toBeInTheDocument()
  expect(toolbar.getByRole('button', { name: 'Chat history' })).toBeInTheDocument()
  expect(toolbar.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
  expect(toolbar.getByRole('button', { name: 'Close MIRA' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: "Hi! I'm MIRA" })).toBeInTheDocument()
})
test('only the latest three follow-ups stay visible beside the composer, with no supporting section', () => {
  mockMessages = [{ id: 1, role: 'assistant', content: 'Reply', data: { message: 'Reply', cards: [{ type: 'info', title: 'Hidden detail', data: { text: 'Extra' } }], suggestedQuestions: ['First', 'Second', 'Third', 'Fourth'] } }]
  render(<MiraChatSidebar />)
  const followups = screen.getByLabelText('Suggested follow-ups')
  expect(followups.querySelectorAll('button')).toHaveLength(3)
  expect(followups.closest('details')).toBeNull()
  expect(followups.parentElement.querySelector('textarea')).not.toBeNull()
  expect(screen.queryByText('Supporting details')).not.toBeInTheDocument()
  expect(screen.queryByText('Hidden detail')).not.toBeInTheDocument()
  expect(screen.queryByText('Fourth')).not.toBeInTheDocument()
})

test('task details render inline without a disclosure and task rows still navigate', async () => {
  mockMessages = [{ id: 1, role: 'assistant', data: { message: 'You have one pending task.', cards: [
    { type: 'progress', title: 'Your Pending Tasks', data: { items: [{ label: 'Task progress', value: 20, max: 100 }] } },
    { type: 'list', title: 'Task Breakdown', data: { items: [{ title: 'My task', link: '/dashboard/projects/my-tasks' }] } },
    { type: 'info', title: 'Unrelated information', data: { text: 'Not needed' } },
  ] } }]
  render(<MiraChatSidebar />)
  expect(screen.getByText('Your Pending Tasks').closest('details')).toBeNull()
  await waitFor(() => expect(screen.getByText('20/100')).toBeVisible())
  expect(screen.queryByText('Supporting details')).not.toBeInTheDocument()
  expect(screen.queryByText('Unrelated information')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'My task' }))
  expect(mockPush).toHaveBeenCalledWith('/dashboard/projects/my-tasks')
})

test('never starts the microphone on mount or expansion', () => {
  render(<MiraChatSidebar />)
  fireEvent.click(screen.getByLabelText('Expand MIRA workspace'))
  expect(screen.getByLabelText('Collapse MIRA sidebar')).toBeInTheDocument()
  expect(mockStart).not.toHaveBeenCalled()
})

test('page navigation minimizes the mounted live session and can restore it', async () => {
  mockStart.mockResolvedValue({ stop: mockStop, stream: {} })
  render(<MiraChatSidebar />)
  await act(async () => fireEvent.click(screen.getByLabelText('Start voice conversation')))
  act(() => window.dispatchEvent(new CustomEvent('mira:navigate', { detail: { page: 'meetings' } })))
  expect(mockPush).toHaveBeenCalledWith('/dashboard/meetings')
  await waitFor(() => expect(screen.getByLabelText('Restore MIRA chat')).toBeVisible())
  expect(mockStop).not.toHaveBeenCalled()
  fireEvent.click(screen.getByLabelText('Restore MIRA chat'))
  expect(screen.getByRole('button', { name: 'Close MIRA' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'End live call' })).not.toBeInTheDocument()
  expect(mockStart).toHaveBeenCalledTimes(1)
})

test('PiP stays voice-first without rendering live user transcription', async () => {
  mockStart.mockResolvedValue({ stop: mockStop, stream: {} })
  render(<MiraChatSidebar />)
  await act(async () => fireEvent.click(screen.getByLabelText('Start voice conversation')))
  act(() => window.dispatchEvent(new CustomEvent('mira:navigate', { detail: { page: 'projects' } })))
  act(() => mockStart.mock.calls.at(-1)[0].onPartial('Mere projects dikhao'))
  const pip = document.querySelector('[data-mira-pip-content]')
  expect(pip).not.toHaveTextContent('Mere projects dikhao')
  expect(pip.querySelector('[aria-label="End live call"]')).not.toBeInTheDocument()
  expect(within(pip).queryByRole('status')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('Restore MIRA chat')).toBeVisible())
  expect(mockStop).not.toHaveBeenCalled()
})

test('voice PiP remains face-only even when assistant captions stream or complete', async () => {
  mockStart.mockResolvedValue({ stop: mockStop, stream: {} })
  mockMessages = [{ id: 1, role: 'assistant', content: 'Main project khol rahi hoon.', streaming: true }]
  const { rerender } = render(<MiraChatSidebar />)
  await act(async () => fireEvent.click(screen.getByLabelText('Start voice conversation')))
  act(() => window.dispatchEvent(new CustomEvent('mira:navigate', { detail: { page: 'projects' } })))
  expect(document.querySelector('[data-mira-pip-content]')).not.toHaveTextContent('Main project khol rahi hoon.')
  mockMessages = [{ id: 1, role: 'assistant', content: 'Project khul gaya hai.' }]
  rerender(<MiraChatSidebar />)
  expect(document.querySelector('[data-mira-pip-content]')).not.toHaveTextContent('Project khul gaya hai.')
})

test('PiP displays completed information above the face and dismissal survives rerenders', () => {
  mockMessages = [{ id: 'result1', role: 'assistant', content: 'Two tasks are due today.' }]
  const { rerender } = render(<MiraChatSidebar />)
  fireEvent.click(screen.getByLabelText('Minimize MIRA to floating voice'))
  expect(screen.getByRole('region', { name: 'Mira details' })).toHaveTextContent('Two tasks are due today.')
  fireEvent.click(screen.getByLabelText('Close Mira details'))
  rerender(<MiraChatSidebar />)
  expect(screen.queryByRole('region', { name: 'Mira details' })).toBeNull()
  expect(mockCloseChat).not.toHaveBeenCalled()
  mockMessages = [{ id: 'result2', role: 'assistant', content: 'Three meetings tomorrow.' }]
  rerender(<MiraChatSidebar />)
  expect(screen.getByRole('region', { name: 'Mira details' })).toHaveTextContent('Three meetings tomorrow.')
})

test('PiP orb restores the main panel, whose close button ends the conversation', async () => {
  render(<MiraChatSidebar />)
  fireEvent.click(screen.getByLabelText('Minimize MIRA to floating voice'))
  expect(screen.queryByText('↗')).toBeNull()
  expect(screen.queryByLabelText('Dismiss MIRA')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Restore MIRA chat'))
  await waitFor(() => expect(screen.getByLabelText('Minimize MIRA to floating voice')).toBeVisible())
  fireEvent.click(screen.getByLabelText('Close MIRA'))
  expect(mockCloseChat).toHaveBeenCalledTimes(1)
})

test('internal PiP and its beam match the app curve while restored chat keeps the sidebar curve', async () => {
  const rail = document.createElement('aside')
  rail.className = 'talio-floating-rail'
  rail.style.borderTopLeftRadius = '8px'
  document.body.append(rail)
  document.documentElement.dataset.desktopPlatform = 'darwin'
  document.documentElement.style.setProperty('--dashboard-window-radius', '14px')
  try {
    render(<MiraChatSidebar />)
    const panel = screen.getByRole('dialog', { name: 'MIRA assistant' })
    expect(panel.style.borderRadius).toBe('8px')
    fireEvent.click(screen.getByLabelText('Minimize MIRA to floating voice'))
    expect(panel.style.borderRadius).toBe('14px')
    expect(mockBeamProps.borderRadius).toBe(14)
    await waitFor(() => expect(document.querySelector('[data-mira-pip-content]')).toBeVisible())
    fireEvent.click(screen.getByLabelText('Restore MIRA chat'))
    expect(panel.style.borderRadius).toBe('8px')
    expect(mockBeamProps.borderRadius).toBe(8)
  } finally {
    rail.remove()
    document.documentElement.removeAttribute('data-desktop-platform')
    document.documentElement.style.removeProperty('--dashboard-window-radius')
  }
})

test('the same sidebar smoothly expands to full width and collapses', () => {
  render(<MiraChatSidebar />)
  const card = screen.getByRole('dialog', { name: 'MIRA assistant' })
  expect(card.style.width).toContain('460px')
  expect(card.style.left).toBe('12px')
  fireEvent.click(screen.getByLabelText('Expand MIRA workspace'))
  expect(card.style.width).toBe('calc(100vw - 24px)')
  expect(card.style.left).toBe('12px')
  expect(card.style.transitionProperty).toBe('opacity, transform')
  expect(screen.getByRole('dialog', { name: 'MIRA assistant' })).toBe(card)
  fireEvent.click(screen.getByLabelText('Collapse MIRA sidebar'))
  expect(card.style.width).toContain('460px')
  expect(card.style.left).toBe('12px')
  expect(card).not.toHaveClass('-translate-x-1/2')
})

test('stops capture if permission resolves after closing', async () => {
  let resolve
  mockStart.mockImplementation(() => new Promise(done => { resolve = done }))
  const view = render(<MiraChatSidebar />)
  await act(async () => fireEvent.click(screen.getByLabelText('Start voice conversation')))
  await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1))
  mockOpen = false
  view.rerender(<MiraChatSidebar />)
  expect(global.fetch.mock.calls.at(-1)[1].signal.aborted).toBe(true)
  await act(async () => { resolve({ stop: mockStop, stream: {} }) })
  expect(mockStop).toHaveBeenCalledTimes(1)
})

test('MIRA opens desktop messages as an overlay without navigating', () => {
  mockOpenWidget.mockClear()
  render(<MiraChatSidebar />)
  act(() => window.dispatchEvent(new CustomEvent('mira:navigate', { detail: { page: 'messages' } })))
  expect(mockOpenWidget).toHaveBeenCalledWith('button')
  expect(mockPush).not.toHaveBeenCalled()
})
