import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ActionableToast from '@/components/ActionableToast'
import toast from '@/utils/toast'
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/utils/toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/components/ui/Loader', () => () => <span>Loading</span>)
const notification = { _id: 'n1', title: 'Probation confirmation', message: 'Review this employee.', type: 'probation_approval', displaySettings: { dismissible: false }, actions: [{ id: 'approve', label: 'Confirm employee', variant: 'success', requiresReason: true }, { id: 'reject', label: 'Reject', variant: 'danger', requiresReason: true }] }
test('remind later is available for nondismissible probation without making a decision', async () => {
  const onSnooze = jest.fn().mockResolvedValue({ success: true }), onAction = jest.fn(), onDismiss = jest.fn()
  render(<ActionableToast notification={notification} onSnooze={onSnooze} onAction={onAction} onDismiss={onDismiss} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remind me in 1 hour' }))
  await waitFor(() => expect(onSnooze).toHaveBeenCalledTimes(1))
  expect(onAction).not.toHaveBeenCalled()
  expect(onDismiss).not.toHaveBeenCalled()
})
test('probation close button snoozes and errors leave decisions available', async () => {
  const onSnooze = jest.fn().mockRejectedValue(new Error('Offline'))
  render(<ActionableToast notification={notification} onSnooze={onSnooze} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss and remind me in 1 hour' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Offline'))
  expect(screen.getByRole('button', { name: 'Confirm employee' })).toBeEnabled()
})
test('rejection still requires remarks', () => {
  const onAction = jest.fn()
  render(<ActionableToast notification={notification} onAction={onAction} />)
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  expect(screen.getByRole('textbox', { name: 'Please provide a reason' })).toBeRequired()
  expect(onAction).not.toHaveBeenCalled()
})
