import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MiraAttention from '@/components/ui/MiraAttention'

const item = { id: 'one', title: 'Review proposal', summary: 'Due in the next 24 hours.', link: '/dashboard/tasks' }
test('attention item actions use the real selected identity and safe navigation callback', async () => {
  const update = jest.fn().mockResolvedValue({ claimed: true }), open = jest.fn()
  render(<MiraAttention attention={{ events: [item], update }} onOpen={open} />)
  fireEvent.click(screen.getByText('Open'))
  expect(open).toHaveBeenCalledWith(item)
  fireEvent.click(screen.getByText('Snooze 30m'))
  await waitFor(() => expect(update).toHaveBeenCalledWith('one', 'snooze', 30))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss Review proposal' }))
  await waitFor(() => expect(update).toHaveBeenCalledWith('one', 'dismiss', undefined))
})
test('recoverable feed errors offer retry without dumping private error details', () => {
  const refresh = jest.fn()
  render(<MiraAttention attention={{ events: [], error: new Error('Provider internals'), refresh }} />)
  expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable')
  expect(screen.queryByText('Provider internals')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Retry')); expect(refresh).toHaveBeenCalled()
})
test('an action failure remains visible and an empty feed takes no space', async () => {
  const view = render(<MiraAttention attention={{ events: [item], update: jest.fn().mockRejectedValue(new Error('Connection interrupted')) }} />)
  fireEvent.click(screen.getByText('Snooze 30m'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted')
  view.rerender(<MiraAttention attention={{ events: [] }} />)
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
})
