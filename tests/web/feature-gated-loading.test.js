/**
 * Feature-gated loading: tenants without a feature must not call its endpoints,
 * so a plan that excludes MIRA or team chat does not pay for those APIs.
 */
import { render, screen, waitFor } from '@testing-library/react'

const socketMock = { onNewMessage: () => () => {}, subscribe: () => () => {}, isConnected: false, socket: null }
jest.mock('@/contexts/SocketContext', () => ({ useSocket: () => socketMock }))

// MeetingSessionProvider (always mounted) reads the router.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => '/dashboard',
}))

let features = {}
jest.mock('@/contexts/CompanyFeaturesContext', () => ({
  useCompanyFeatures: () => ({ features }),
}))

// MIRA overlays are dynamically imported; stub them so the test stays on the gate.
jest.mock('@/components/ui/GlobalAILoadingOverlay', () => () => null)
jest.mock('@/components/ui/MiraTransitionOverlay', () => () => null)
jest.mock('@/components/ui/MiraPermissionChecklist', () => () => null)
jest.mock('@/components/AIAssistant', () => () => null)
jest.mock('@/components/AIAssistantBridge', () => () => null)

import { UnreadMessagesProvider } from '@/contexts/UnreadMessagesContext'
import DashboardAIProviders from '@/components/DashboardAIProviders'

beforeEach(() => {
  features = {}
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ success: true }) }))
  localStorage.setItem('token', 'test-token')
})
afterEach(() => { delete global.fetch; localStorage.clear(); jest.clearAllMocks() })

test('unread messages are not fetched when the tenant plan excludes team chat', async () => {
  features = { teamChat: false }
  render(<UnreadMessagesProvider><div>child</div></UnreadMessagesProvider>)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(fetch).not.toHaveBeenCalledWith('/api/chat/unread', expect.anything())
})

test('unread messages are fetched when team chat is enabled', async () => {
  features = { teamChat: true }
  render(<UnreadMessagesProvider><div>child</div></UnreadMessagesProvider>)
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/chat/unread', expect.anything()))
})

test('MIRA providers are skipped when the plan excludes miraAI', () => {
  features = { miraAI: false }
  render(<DashboardAIProviders><div data-testid="page">page</div></DashboardAIProviders>)
  // Children still render, but without the MIRA shell around them.
  expect(screen.getByTestId('page')).toBeInTheDocument()
})

test('MIRA providers mount when the plan includes miraAI', () => {
  features = { miraAI: true }
  render(<DashboardAIProviders><div data-testid="page">page</div></DashboardAIProviders>)
  expect(screen.getByTestId('page')).toBeInTheDocument()
})

test('features are not assumed when the payload has not loaded yet', () => {
  features = undefined
  render(<DashboardAIProviders><div data-testid="page">page</div></DashboardAIProviders>)
  expect(screen.getByTestId('page')).toBeInTheDocument()
})
