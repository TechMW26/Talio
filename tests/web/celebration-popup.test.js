import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CelebrationPopup from '@/components/CelebrationPopup'
import { sendCelebrationWishes } from '@/lib/client/celebrationWishes'

jest.mock('canvas-confetti', () => jest.fn())
jest.mock('@/components/chat/MemberAvatar', () => () => null)
jest.mock('@/lib/client/celebrationWishes', () => ({ sendCelebrationWishes: jest.fn() }))
jest.mock('@/hooks/useAuthedSWR', () => {
  const data = { success: true, currentEmployeeId: 'sender', birthdays: [{ _id: 'recipient', firstName: 'Garima', lastName: 'Sharma' }], anniversaries: [] }
  return { __esModule: true, default: () => ({ data }) }
})

beforeEach(() => {
  sessionStorage.clear()
  localStorage.setItem('token', 'test-token')
  jest.clearAllMocks()
})

test('waits for persistence, prevents duplicate clicks, then shows success', async () => {
  let finish
  sendCelebrationWishes.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<CelebrationPopup />)
  fireEvent.click(await screen.findByRole('button', { name: /Send Wishes/ }))
  const sending = screen.getByRole('button', { name: /Sending wishes/ })
  expect(sending.disabled).toBe(true)
  fireEvent.click(sending)
  expect(sendCelebrationWishes).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Wishes sent in private chat!')).toBeNull()
  finish()
  await screen.findByText('Wishes sent in private chat!')
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
})

test('keeps the popup open on failure and allows retry', async () => {
  sendCelebrationWishes.mockRejectedValueOnce(new Error('Could not send wishes.'))
    .mockResolvedValueOnce(undefined)
  render(<CelebrationPopup />)
  fireEvent.click(await screen.findByRole('button', { name: /Send Wishes/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send wishes.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry remaining wishes' }))
  await waitFor(() => expect(screen.getByText('Wishes sent in private chat!')).toBeTruthy())
  expect(sendCelebrationWishes).toHaveBeenCalledTimes(2)
})
