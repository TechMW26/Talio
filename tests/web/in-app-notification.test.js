import { act, fireEvent, render, screen } from '@testing-library/react'
import InAppNotification from '@/components/InAppNotification'

const push = jest.fn()
const openChat = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
jest.mock('@/contexts/ChatWidgetContext', () => ({ useChatWidget: () => ({ openChat }) }))
const item = { type: 'task_assigned', title: 'Review the proposal', message: 'A new task is ready.', url: '/dashboard/tasks' }
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); localStorage.clear() })
afterEach(() => jest.useRealTimers())

test('navigation is an explicit action, not the entire card', async () => {
  const onClose = jest.fn()
  render(<InAppNotification notification={item} onClose={onClose} />)
  fireEvent.click(screen.getByText(item.message))
  expect(push).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'View task' }))
  expect(push).toHaveBeenCalledWith('/dashboard/tasks')
  await act(async () => jest.advanceTimersByTime(220))
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('hover and keyboard focus pause expiry; dismissal does not navigate', async () => {
  const onClose = jest.fn()
  render(<InAppNotification notification={item} onClose={onClose} />)
  const region = screen.getByRole('region', { name: item.title })
  fireEvent.mouseEnter(region)
  await act(async () => jest.advanceTimersByTime(10000))
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.focus(screen.getByRole('button', { name: 'View task' }))
  fireEvent.mouseLeave(region)
  await act(async () => jest.advanceTimersByTime(10000))
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Close notification' }))
  await act(async () => jest.advanceTimersByTime(220))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(push).not.toHaveBeenCalled()
})

test('chat notifications without a URL open the existing conversation', async () => {
  render(<InAppNotification notification={{ type: 'message', title: 'New message', chatId: 'chat-1', message: 'Hello' }} onClose={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
  expect(openChat).toHaveBeenCalledWith({ _id: 'chat-1', participants: [] })
  expect(push).not.toHaveBeenCalled()
})

test('informational notices expose dismissal and clean up timers on unmount', async () => {
  const onClose = jest.fn()
  const view = render(<InAppNotification notification={{ title: 'Updated', message: 'Saved.' }} onClose={onClose} />)
  expect(screen.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  view.unmount()
  await act(async () => jest.runAllTimers())
  expect(onClose).not.toHaveBeenCalled()
})
