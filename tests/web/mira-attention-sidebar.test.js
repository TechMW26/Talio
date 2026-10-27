import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import MiraChatSidebar from '@/components/MiraChatSidebar'

let mockMode = 'chat', mockHistory = false, mockVoiceActive = false, mockEvents = []
let mockMessages = []
const mockUpdate = jest.fn(), mockPush = jest.fn(), mockStart = jest.fn(), mockStop = jest.fn()
const reminder = { id: 'reminder-1', title: 'Call the team', summary: 'Your requested reminder is due.', link: '/dashboard', occurredAt: '2026-10-28T09:00:00.000Z' }

jest.mock('@/hooks/useMiraProactive', () => ({ __esModule: true, default: () => ({ events: mockEvents, update: mockUpdate, refresh: jest.fn(), feed: { quietHours: false } }) }))
jest.mock('@/utils/userHelper', () => ({ getCurrentUser: () => ({ id: 'user-one', databaseName: 'tenant-one' }), getUserId: user => user?.id }))
jest.mock('@/contexts/ChatWidgetContext', () => ({ useChatWidget: () => ({ openWidget: jest.fn() }) }))
jest.mock('@/contexts/MiraChatContext', () => ({ useMiraChat: () => ({
  isOpen: true, closeChat: jest.fn(), messages: mockMessages, sendMessage: jest.fn(),
  viewMode: mockMode, setViewMode: jest.fn(), showHistory: mockHistory,
  sessions: [], activeSessionId: 'session-one', tokens: {}, toggleHistory: jest.fn(), startNewChat: jest.fn(),
}) }))
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ isDarkMode: true, theme: { primary: { 50: '#111', 100: '#222', 200: '#333', 300: '#444', 400: '#555', 500: '#666', 600: '#777', 700: '#888', 900: '#aaa' } } }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), usePathname: () => '/dashboard' }))
jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }))
jest.mock('framer-motion', () => ({ useReducedMotion: () => true }))
jest.mock('voice-glow', () => ({ VoiceBeam: ({ children, className }) => <div className={className}>{children}</div> }))
jest.mock('@/hooks/useMiraVoice', () => ({ __esModule: true, default: () => ({ active: mockVoiceActive, state: 'listening', start: mockStart, stop: mockStop }), prewarmMiraVoice: () => Promise.resolve() }))
jest.mock('@/hooks/useMiraCamera', () => ({ __esModule: true, default: () => ({ inspect: jest.fn(), stop: jest.fn() }) }))
jest.mock('@/hooks/useMiraSidebarDrag', () => ({ __esModule: true, default: () => ({ handlers: {} }) }))
jest.mock('@/hooks/useMiraPanelVisible', () => ({ __esModule: true, default: () => true }))
jest.mock('@/hooks/useMiraWindowRadius', () => ({ __esModule: true, default: () => 14 }))
jest.mock('@/lib/miraClientContext', () => ({ prepareMiraLocation: jest.fn() }))
jest.mock('@/components/ui/NativePipSurface', () => {
  const React = require('react')
  return { __esModule: true, default: React.forwardRef(({ children }, ref) => {
    React.useImperativeHandle(ref, () => ({ restore: jest.fn() }))
    return <>{children}</>
  }) }
})
jest.mock('@/components/ui/MiraFloatingFace', () => ({ __esModule: true, default: ({ details, onCloseDetails }) => <div data-testid="floating-face">
  {details && <section aria-label="Mira details"><button onClick={onCloseDetails}>Close Mira details</button>{details}</section>}
  <div aria-label="Restore MIRA chat" />
</div> }))
jest.mock('@/components/ui/MiraVoiceCall', () => ({ __esModule: true, default: require('react').forwardRef(() => <div aria-label="Voice-only view" />) }))
jest.mock('@/components/ui/MiraPet', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('@/components/ui/MiraCameraNotch', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/MiraActivityPointer', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/AIActivityBeam', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/MiraVoiceConnecting', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/ui/MiraAttachments', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/MiraWakeSetup', () => ({ __esModule: true, default: () => null }))

beforeEach(() => {
  jest.clearAllMocks()
  mockMode = 'chat'; mockHistory = false; mockVoiceActive = false; mockEvents = [reminder]; mockMessages = []
  mockUpdate.mockResolvedValue({})
  jest.spyOn(window, 'focus').mockImplementation(() => {})
  Element.prototype.scrollIntoView = jest.fn()
})

test.each(['chat', 'voice', 'history'])('shows exactly one attention stack in %s mode without starting or interrupting speech', mode => {
  mockVoiceActive = mode === 'voice'; mockHistory = mode === 'history'
  render(<MiraChatSidebar />)
  expect(screen.getAllByRole('region', { name: 'Mira attention' })).toHaveLength(1)
  expect(screen.getByText('Call the team')).toBeVisible()
  if (mockVoiceActive) expect(screen.getByLabelText('Voice-only view')).toBeInTheDocument()
  if (mockHistory) expect(screen.getByRole('heading', { name: 'Chat History' })).toBeInTheDocument()
  expect(mockStart).not.toHaveBeenCalled(); expect(mockStop).not.toHaveBeenCalled()
})

test('floating voice presents one reminder in the existing details lens and keeps its actions connected', async () => {
  mockMode = 'pip'; mockVoiceActive = true
  render(<MiraChatSidebar />)
  const details = screen.getByRole('region', { name: 'Mira details' })
  expect(within(details).getByRole('region', { name: 'Mira attention' })).toBeVisible()
  expect(screen.getAllByRole('region', { name: 'Mira attention' })).toHaveLength(1)
  fireEvent.click(within(details).getByText('Snooze 30m'))
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('reminder-1', 'snooze', 30))
  fireEvent.click(within(details).getByRole('button', { name: 'Dismiss Call the team' }))
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('reminder-1', 'dismiss', undefined))
  fireEvent.click(within(details).getByText('Open'))
  expect(mockPush).toHaveBeenCalledWith('/dashboard')
  expect(mockStart).not.toHaveBeenCalled(); expect(mockStop).not.toHaveBeenCalled()
})

test('closing floating details hides that group locally, and a new reminder reopens the lens', () => {
  mockMode = 'pip'
  const view = render(<MiraChatSidebar />)
  fireEvent.click(screen.getByRole('button', { name: 'Close Mira details' }))
  expect(screen.queryByRole('region', { name: 'Mira details' })).not.toBeInTheDocument()
  expect(mockUpdate).not.toHaveBeenCalled()
  view.rerender(<MiraChatSidebar />)
  expect(screen.queryByRole('region', { name: 'Mira details' })).not.toBeInTheDocument()
  mockEvents = [{ ...reminder, id: 'new-reminder', title: 'A new reminder' }]
  view.rerender(<MiraChatSidebar />)
  expect(screen.getByText('A new reminder')).toBeVisible()
})

test('floating view is still bot-only when no attention or visual result exists', () => {
  mockMode = 'pip'; mockVoiceActive = true; mockEvents = []
  render(<MiraChatSidebar />)
  expect(screen.getByTestId('floating-face')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Mira details' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Mira attention' })).not.toBeInTheDocument()
})

test('floating attention does not replace an existing requested tool result', async () => {
  mockMode = 'pip'; mockVoiceActive = true
  mockMessages = [{ id: 'result', role: 'assistant', data: { voiceTool: true, message: 'Your calculation is ready.', cards: [{ type: 'info', title: 'Result', data: { text: '42' } }] } }]
  render(<MiraChatSidebar />)
  const details = within(screen.getByRole('region', { name: 'Mira details' }))
  expect(details.getByText('Call the team')).toBeVisible()
  expect(details.getByText('Your calculation is ready.')).toBeVisible()
})
