import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockOpenChat = jest.fn()
const mockCloseWidget = jest.fn()
const mockUpdateWidgetPosition = jest.fn()

jest.mock('@/contexts/ChatWidgetContext', () => ({
  useChatWidget: () => ({
    isWidgetOpen: true,
    toggleWidget: jest.fn(),
    closeWidget: mockCloseWidget,
    openChat: mockOpenChat,
    widgetPosition: { x: null, y: null },
    updateWidgetPosition: mockUpdateWidgetPosition,
    triggerSource: 'floating',
    sidebarCollapsed: false,
  }),
}))

jest.mock('@/contexts/UnreadMessagesContext', () => ({
  useUnreadMessages: () => ({ unreadChats: {} }),
}))

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: { primary: { 500: '#3B82F6', 600: '#2563EB' } },
    isDarkMode: false,
  }),
}))

jest.mock('@/contexts/SocketContext', () => ({
  useSocket: () => ({
    isConnected: false,
    requestPresence: jest.fn(),
    onPresenceStatus: () => jest.fn(),
    onPresenceUpdate: () => jest.fn(),
  }),
}))

jest.mock('@/components/ui/Loader', () => function MockLoader() {
  return <span>Loading</span>
})

jest.mock('@/utils/toast', () => ({
  __esModule: true,
  default: { success: jest.fn() },
}))

import FloatingChatWidget from '@/components/chat/FloatingChatWidget'
import toast from '@/utils/toast'

describe('FloatingChatWidget group creation', () => {
  beforeEach(() => {
    mockOpenChat.mockClear()
    mockCloseWidget.mockClear()
    mockUpdateWidgetPosition.mockClear()
    toast.success.mockClear()
    window.localStorage.clear()
    window.localStorage.setItem('token', 'test-token')
    window.localStorage.setItem('user', JSON.stringify({ _id: 'user-1', employeeId: 'employee-1' }))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })

    global.fetch = jest.fn(async (url, options = {}) => {
      if (url === '/api/employees/list?includeAdmins=true') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [{
              _id: 'employee-2',
              firstName: 'Asha',
              lastName: 'Rao',
              email: 'asha@example.com',
              department: { name: 'Engineering' },
            }],
          }),
        }
      }

      if (url === '/api/chat' && options.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { _id: 'group-1', isGroup: true, name: 'Launch Team', participants: [] },
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({ success: true, data: [], currentUserId: 'employee-1' }),
      }
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('creates a group from the floating chat window and opens it', async () => {
    render(<FloatingChatWidget />)

    fireEvent.click(await screen.findByRole('button', { name: 'New group' }))
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Launch Team' } })
    fireEvent.click(await screen.findByRole('button', { name: /Asha Rao/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          isGroup: true,
          participants: ['employee-2'],
          name: 'Launch Team',
        }),
      }))
      expect(mockOpenChat).toHaveBeenCalledWith(expect.objectContaining({ _id: 'group-1' }))
      expect(toast.success).toHaveBeenCalledWith('Group created')
    })
  })
})
