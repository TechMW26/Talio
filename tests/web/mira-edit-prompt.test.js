import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import MiraEditPrompt from '@/components/MiraEditPrompt'
beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true } })
test('edit uses original text, trims resend and supports keyboard shortcut', () => {
  const onSave = jest.fn(), message = { id: 1, content: 'Original' }
  render(<MiraEditPrompt message={message} onClose={jest.fn()} onSave={onSave} />)
  const input = screen.getByLabelText('Edit message text')
  expect(input).toHaveValue('Original')
  fireEvent.change(input, { target: { value: '  Revised  ' } })
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
  expect(onSave).toHaveBeenCalledWith(message, 'Revised')
})
test('cancel does not send and empty text cannot be resent', () => {
  const onSave = jest.fn(), onClose = jest.fn()
  render(<MiraEditPrompt message={{ content: 'Original' }} onClose={onClose} onSave={onSave} />)
  fireEvent.change(screen.getByLabelText('Edit message text'), { target: { value: ' ' } })
  expect(screen.getByText('Resend')).toBeDisabled()
  fireEvent.click(screen.getByText('Cancel'))
  expect(onClose).toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
})
