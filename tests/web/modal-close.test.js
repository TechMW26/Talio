import { render, screen, fireEvent } from '@testing-library/react'
import Modal from '@/components/ui/HeroModal'
import { ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { useState } from 'react'
import fs from 'fs'
import path from 'path'
import postcss from 'postcss'

test('default close icon uses a standard compact size and stroke', () => {
  render(<Modal isOpen disableAnimation><ModalContent><ModalHeader>Example</ModalHeader></ModalContent></Modal>)
  const icon = screen.getByRole('button', { name: 'Close' }).querySelector('svg')
  expect(icon).toHaveAttribute('width', '18')
  expect(icon).toHaveAttribute('height', '18')
  expect(icon).toHaveAttribute('stroke-width', '2')
})

test('shared close styles are compact with larger touch targets', () => {
  const css = postcss.parse(fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8'))
  const rules = []
  css.walkRules(rule => rules.push(rule))
  const controls = rules.find(rule => rule.selector.includes('button[title="Close"]') && rule.parent.type === 'root' && !rule.selector.includes('svg'))
  const icons = rules.find(rule => rule.selector.includes('button[title="Close"] svg'))
  const touch = rules.find(rule => rule.selector.includes('button[title="Close"]') && rule.parent.params === '(pointer: coarse)')
  for (const prop of ['min-width', 'min-height']) {
    expect(controls.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ prop, value: '32px' })]))
    expect(touch.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ prop, value: '44px' })]))
  }
  for (const prop of ['width', 'height']) {
    expect(icons.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ prop, value: '18px', important: true })]))
  }
})

test('close button notifies the owner once', () => {
  const onClose = jest.fn()
  const onOpenChange = jest.fn()
  render(<Modal isOpen disableAnimation onClose={onClose} onOpenChange={onOpenChange}><ModalContent><ModalHeader>Example</ModalHeader><ModalBody>Content</ModalBody></ModalContent></Modal>)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test.each(['Enter', ' '])('keyboard %s closes an uncontrolled popup', key => {
  const onClose = jest.fn()
  render(<Modal defaultOpen disableAnimation onClose={onClose}><ModalContent><ModalHeader>Example</ModalHeader></ModalContent></Modal>)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key })
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('controlled popup closes and can reopen', () => {
  function Example() {
    const [open, setOpen] = useState(true)
    return <><button onClick={() => setOpen(true)}>Open</button><Modal isOpen={open} onOpenChange={setOpen} disableAnimation><ModalContent><ModalHeader>Example</ModalHeader></ModalContent></Modal></>
  }
  render(<Example />)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('required popup retains its non-dismissible configuration', () => {
  render(<Modal isOpen disableAnimation hideCloseButton isDismissable={false} isKeyboardDismissDisabled><ModalContent><ModalHeader>Required</ModalHeader></ModalContent></Modal>)
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('controlled owner can refuse closing while work is in progress', () => {
  const onOpenChange = jest.fn()
  render(<Modal isOpen disableAnimation onOpenChange={onOpenChange}><ModalContent><ModalHeader>Uploading</ModalHeader></ModalContent></Modal>)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
