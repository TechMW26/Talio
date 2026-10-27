import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Select, Popover } from '@/components/ui/PopupMotion'
import { SelectItem, PopoverTrigger, PopoverContent, Button } from '@heroui/react'

beforeEach(() => {
  window.matchMedia = jest.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = jest.fn()
})

test('shared select preserves React Aria collection discovery and selection', async () => {
  const change = jest.fn()
  render(<Select label="Team" onSelectionChange={change}>
    <SelectItem key="operations">Operations</SelectItem>
    <SelectItem key="engineering">Engineering</SelectItem>
  </Select>)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(await screen.findByRole('option', { name: 'Engineering' }))
  await waitFor(() => expect(change).toHaveBeenCalled())
  expect([...change.mock.calls.at(-1)[0]]).toEqual(['engineering'])
})

test('shared popover retains accessible content and Escape dismissal', async () => {
  render(<Popover><PopoverTrigger><Button>Show details</Button></PopoverTrigger>
    <PopoverContent><p>Popover details</p></PopoverContent></Popover>)
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
  const dialog = await screen.findByRole('dialog')
  expect(screen.getByText('Popover details')).toBeVisible()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
