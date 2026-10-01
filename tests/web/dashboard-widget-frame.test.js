import React from 'react'
import { render } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import DraggableWidget from '@/components/dashboard/DraggableWidget'

let mockDragging = false
jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: jest.fn(), transform: null, transition: null, isDragging: mockDragging }),
}))

afterEach(() => { mockDragging = false })

test('frameless widgets leave the border and radius to their content', () => {
  const { container } = render(<DraggableWidget id="test" frameless><section>Content</section></DraggableWidget>)
  const shell = container.firstChild
  expect(shell.className).toContain('border-0 rounded-none')
  expect(shell.className).not.toContain('rounded-2xl')
  expect(shell.className).not.toContain('hover:shadow-lg')
  expect(shell.className).not.toContain('overflow-hidden')
})

test('standalone framed widgets retain their frame', () => {
  const { container } = render(<DraggableWidget id="test">Content</DraggableWidget>)
  expect(container.firstChild.className).toContain('rounded-2xl')
})

test('frameless widgets retain the drag indicator and handle', () => {
  mockDragging = true
  const { container, getByTitle } = render(<DraggableWidget id="test" frameless>Content</DraggableWidget>)
  expect(container.firstChild.className).toContain('ring-2 ring-primary-500')
  expect(getByTitle('Drag to reorder')).toBeTruthy()
})

test('dashboard cards use frameless wrappers without a competing clipping radius', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/dashboard/CustomizableDashboard.js'), 'utf8')
  expect(source).toMatch(/\sframeless\s/)
  expect(source).not.toContain('rounded-[18px] overflow-hidden')
})
