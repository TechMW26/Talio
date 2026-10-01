import { fireEvent, render, screen } from '@testing-library/react'
import ParticipantGrid from '@/components/meetings/ParticipantGrid'

const originalObserver = global.ResizeObserver
beforeEach(() => {
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe() { this.callback([{ contentRect: { width: 480, height: 250 } }]) }
    disconnect() {}
  }
})
afterEach(() => { global.ResizeObserver = originalObserver })
const people = count => Array.from({ length: count }, (_, i) => <div key={i}>Person {i}</div>)

test('PiP renders at most four participants and clamps the page after departures', () => {
  const view = render(<ParticipantGrid count={9} pip>{people(9)}</ParticipantGrid>)
  expect(screen.getAllByText(/Person/)).toHaveLength(4)
  expect(screen.queryByText('Person 4')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Next participants'))
  expect(screen.getByText('Person 4')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Next participants'))
  expect(screen.getAllByText(/Person/)).toHaveLength(1)
  expect(screen.getByLabelText('Next participants')).toBeDisabled()
  view.rerender(<ParticipantGrid count={3} pip>{people(3)}</ParticipantGrid>)
  expect(screen.getAllByText(/Person/)).toHaveLength(3)
  expect(screen.queryByLabelText('Participant pages')).not.toBeInTheDocument()
})

test('swiping advances a page while full meeting mode retains all participants', () => {
  const view = render(<ParticipantGrid count={6} pip>{people(6)}</ParticipantGrid>)
  const grid = view.container.firstChild
  fireEvent.touchStart(grid, { touches: [{ clientX: 200 }] })
  fireEvent.touchEnd(grid, { changedTouches: [{ clientX: 80 }] })
  expect(screen.getByText('Person 4')).toBeInTheDocument()
  view.rerender(<ParticipantGrid count={6}>{people(6)}</ParticipantGrid>)
  expect(screen.getAllByText(/Person/)).toHaveLength(6)
})
