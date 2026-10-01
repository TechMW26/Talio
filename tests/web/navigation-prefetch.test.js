import { fireEvent, render, screen } from '@testing-library/react'
import { PageTransitionProvider } from '@/contexts/PageTransitionContext'

const mockPrefetch = jest.fn()
const mockRouter = { prefetch: mockPrefetch }
jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => mockRouter }))

test('warms internal pages on hover and keyboard focus without prefetching external or chat links', () => {
  render(<PageTransitionProvider>
    <a href="/dashboard/documents">Documents</a>
    <a href="https://example.com">External</a>
    <a href="/dashboard/chat">Chat</a>
  </PageTransitionProvider>)
  fireEvent.pointerOver(screen.getByText('Documents'))
  fireEvent.focusIn(screen.getByText('Documents'))
  fireEvent.pointerOver(screen.getByText('External'))
  fireEvent.pointerOver(screen.getByText('Chat'))
  expect(mockPrefetch).toHaveBeenCalledTimes(1)
  expect(mockPrefetch).toHaveBeenCalledWith('/dashboard/documents', expect.objectContaining({ onInvalidate: expect.any(Function) }))
})
