import { render, screen, fireEvent, within, act } from '@testing-library/react'
import KanbanBoard, { canMoveTask } from '@/components/tasks/KanbanBoard'

const task = { _id: 'one', title: 'Design review', status: 'todo', priority: 'high', project: { _id: 'p1', name: 'Talio' }, assignees: [{ _id: 'a1', assignmentStatus: 'accepted', user: { firstName: 'Alex' } }] }

test('shared board keeps details and project actions separate', () => {
  const open = jest.fn(), project = jest.fn()
  render(<KanbanBoard tasks={[task]} onTaskClick={open} onProjectClick={project} showProject />)
  fireEvent.click(screen.getByRole('button', { name: 'Talio' }))
  expect(project).toHaveBeenCalledWith('p1')
  expect(open).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('article', { name: 'Design review, To Do' }), { key: 'Enter' })
  expect(open).toHaveBeenCalledWith(task)
})
test('native drop calls the existing status handler without locally changing data', () => {
  const move = jest.fn(), dataTransfer = { setData: jest.fn() }
  render(<KanbanBoard tasks={[task]} onStatusChange={move} />)
  fireEvent.dragStart(screen.getByRole('article'), { dataTransfer })
  const column = screen.getByRole('region', { name: 'In Progress' })
  fireEvent.dragOver(column, { dataTransfer })
  fireEvent.drop(column, { dataTransfer })
  expect(move).toHaveBeenCalledWith(task, 'in-progress')
  expect(within(screen.getByRole('region', { name: 'To Do' })).getByText('Design review')).toBeInTheDocument()
})
test('Fernly move menu provides touch/keyboard equivalent with the same callback', () => {
  const move = jest.fn(), open = jest.fn()
  render(<KanbanBoard tasks={[task]} onStatusChange={move} onTaskClick={open} />)
  fireEvent.click(screen.getByRole('button', { name: 'Move Design review' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review', exact: true }))
  expect(move).toHaveBeenCalledWith(task, 'review')
  expect(open).not.toHaveBeenCalled()
})
test('pending, subtask managed and read-only cards retain move restrictions', () => {
  const pending = { ...task, assignmentStatus: 'pending', assignees: [] }
  expect(canMoveTask(pending, true)).toBe(false)
  expect(canMoveTask({ ...task, subtasks: [{ completed: false }] }, true)).toBe(false)
  expect(canMoveTask(task, false)).toBe(false)
  render(<KanbanBoard tasks={[pending]} onStatusChange={jest.fn()} />)
  expect(screen.getByRole('article')).toHaveAttribute('draggable', 'false')
  expect(screen.queryByRole('button', { name: 'Move Design review' })).not.toBeInTheDocument()
  expect(screen.getByText('Pending acceptance')).toBeInTheDocument()
})
test('review approval tasks are visible, empty columns remain drop targets', () => {
  render(<KanbanBoard tasks={[{ ...task, status: 'completed-pending-approval' }]} />)
  expect(within(screen.getByRole('region', { name: 'Review' })).getByText('Design review')).toBeInTheDocument()
  expect(screen.getAllByText('No tasks here yet')).toHaveLength(3)
})

test('pointer drag makes a card-sized slot, settles, then uses the existing status handler', () => {
  jest.useFakeTimers()
  const move = jest.fn()
  render(<KanbanBoard tasks={[task, { ...task, _id: 'two', title: 'Next task', status: 'in-progress' }]} onStatusChange={move} />)
  const card = screen.getByRole('article', { name: 'Design review, To Do' })
  card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 250, height: 160 })
  const column = screen.getByRole('region', { name: 'In Progress' })
  const next = within(column).getByRole('article')
  next.getBoundingClientRect = () => ({ top: 200, height: 160 })
  const original = document.elementFromPoint
  document.elementFromPoint = jest.fn(() => next)
  fireEvent(card, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 }))
  fireEvent(window, new MouseEvent('pointermove', { clientX: 300, clientY: 100 }))
  expect(within(column).getByRole('status', { name: 'Drop task here' })).toHaveStyle({ height: '160px' })
  expect(document.querySelector('[data-drop-slot]').nextElementSibling).toContainElement(next)
  expect(move).not.toHaveBeenCalled()
  fireEvent(window, new MouseEvent('pointerup'))
  act(() => jest.advanceTimersByTime(350))
  expect(move).toHaveBeenCalledWith(task, 'in-progress')
  expect(document.querySelector('[data-drop-slot]')).toBeNull()
  document.elementFromPoint = original
  jest.useRealTimers()
})

test('cancelled pointer drags remove projection without mutating status', () => {
  const move = jest.fn()
  const { unmount } = render(<KanbanBoard tasks={[task]} onStatusChange={move} />)
  const original = document.elementFromPoint
  document.elementFromPoint = jest.fn(() => screen.getByRole('region', { name: 'Review' }))
  fireEvent(screen.getByRole('article'), new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  fireEvent(window, new MouseEvent('pointermove', { clientX: 100, clientY: 100 }))
  expect(screen.getByRole('status')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(move).not.toHaveBeenCalled()
  unmount()
  document.elementFromPoint = original
})
