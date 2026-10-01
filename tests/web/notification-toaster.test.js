import { fireEvent, render, screen } from '@testing-library/react'
import NotificationToaster from '@/components/ui/NotificationToaster'
import { toast } from 'react-hot-toast'

jest.mock('react-hot-toast', () => ({
  Toaster: ({ children }) => children({ id: 'feedback-1' }),
  ToastBar: ({ children }) => children({ icon: <span>✓</span>, message: <span>Saved successfully</span> }),
  toast: { dismiss: jest.fn() },
}))

test('standard feedback preserves the message and offers explicit dismissal', () => {
  render(<NotificationToaster />)
  expect(screen.getByText('Saved successfully')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
  expect(toast.dismiss).toHaveBeenCalledWith('feedback-1')
})
