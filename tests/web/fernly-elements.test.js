import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NativeButton, NativeInput, NativeSelect, Heading2, Input, SelectItem } from '@/components/ui/fernly'

jest.mock('@heroui/react', () => {
  const React = require('react')
  return {
    Input: React.forwardRef(({ classNames, ...props }, ref) => <input {...props} ref={ref} data-wrapper={classNames.inputWrapper} />),
    SelectItem: Object.assign(() => null, { getCollectionNode: () => 'collection' }),
  }
})
jest.mock('@/components/ui/HeroModal', () => ({ __esModule: true, default: () => null }))

test('native button preserves disabled, click, type, class and ref behavior', () => {
  const ref = createRef(), click = jest.fn()
  const { rerender } = render(<NativeButton ref={ref} type="button" className="existing-placement" onClick={click}>Save</NativeButton>)
  expect(ref.current.tagName).toBe('BUTTON')
  expect(ref.current.className).toContain('existing-placement')
  fireEvent.click(ref.current)
  expect(click).toHaveBeenCalledTimes(1)
  rerender(<NativeButton disabled onClick={click}>Save</NativeButton>)
  fireEvent.click(screen.getByRole('button'))
  expect(click).toHaveBeenCalledTimes(1)
})
test('native form semantics and heading level remain unchanged', () => {
  const change = jest.fn()
  render(<><Heading2>Details</Heading2><NativeInput aria-label="Name" defaultValue="A" onChange={change} /><NativeSelect aria-label="Department" defaultValue="tech"><option value="tech">Tech</option></NativeSelect></>)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B' } })
  expect(change).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('combobox').value).toBe('tech')
  expect(screen.getByRole('heading', { level: 2 })).toBeTruthy()
})
test('slot styles preserve caller additions and collection metadata', () => {
  render(<Input aria-label="Styled" classNames={{ inputWrapper: 'existing-field' }} />)
  expect(screen.getByRole('textbox').dataset.wrapper).toContain('existing-field')
  expect(SelectItem.getCollectionNode()).toBe('collection')
})
