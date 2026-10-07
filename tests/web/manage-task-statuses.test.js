import { render, screen, fireEvent } from '@testing-library/react'
import ManageTaskStatusesModal from '@/components/tasks/ManageTaskStatusesModal'
import { DEFAULT_TASK_STATUSES } from '@/lib/taskStatusConfig'

const statuses = [...DEFAULT_TASK_STATUSES.slice(0, 4), { key: 'qa', label: 'QA', color: 'blue', isSystem: false }]
test('modal edits shared controls and only removes unused statuses after confirmation', () => {
  const save = jest.fn()
  render(<ManageTaskStatusesModal isOpen statuses={statuses} onSave={save} />)
  expect(screen.getByRole('dialog', { name: 'Manage Task Statuses' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Status 5 name' }), { target: { value: 'Quality' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Status 5 color' }), { target: { value: 'pink' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Statuses' }))
  expect(save.mock.calls[0][0].at(-1)).toMatchObject({ key: 'qa', label: 'Quality', color: 'pink' })
  fireEvent.click(screen.getByRole('button', { name: 'Delete Quality' }))
  expect(screen.getByRole('button', { name: 'Yes, Delete' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save Statuses' }))
  expect(save.mock.calls[1][0]).toHaveLength(4)
})
test('used statuses and built-ins cannot be removed in the modal', () => {
  render(<ManageTaskStatusesModal isOpen statuses={statuses} taskCounts={{ qa: 2 }} />)
  expect(screen.queryByRole('button', { name: 'Delete To Do' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Delete QA' }))
  expect(screen.getByText(/2 tasks are/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Yes, Delete' })).toBeNull()
})
test('saving locks editing and repeat submissions', () => {
  render(<ManageTaskStatusesModal isOpen statuses={statuses} saving />)
  expect(screen.getByRole('textbox', { name: 'Status 1 name' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Status 1 color' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Add status' })).toBeDisabled()
})
