import React from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HeroUIProvider } from '@heroui/react'
import FolderDocumentSurface from '@/components/employees/FolderDocumentSurface'
import { folderGenieFrames } from '@/lib/client/folderGenie'

jest.mock('@/components/employees/DocumentThumbnail', () => () => <span>Preview</span>)
const folder = { name: 'Asha', documents: [{ _id: 'one', fileName: 'Letter' }] }
const sourceElement = { getBoundingClientRect: () => ({ left: 100, top: 300, width: 240, height: 300 }) }

beforeEach(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
afterEach(() => { delete Element.prototype.animate })

test('original lightweight geometry unfurls from the source without clone layers', () => {
  const target = { left: 20, top: 80, width: 200, height: 300 }
  const frames = folderGenieFrames(sourceElement.getBoundingClientRect(), target)
  expect(frames).toHaveLength(4)
  expect(frames[0].transform).toBe('translate(100px, 190px) scale(0.65, .04)')
  expect(frames[3]).toMatchObject({ opacity: 1, transform: 'translate(0, 0) scale(1, 1)' })
})

test.each([-400, 700])('transforms stay finite with the folder at y=%i', top => {
  const frames = folderGenieFrames({ left: 800, top, width: 240, height: 300 }, { left: 30, top: 100, width: 220, height: 350 })
  frames.forEach(frame => expect(frame.transform).not.toMatch(/NaN|Infinity/))
})

test('closing waits for reverse animation and document actions remain available', async () => {
  const finishExit = []
  const animate = jest.fn((frames, options) => ({ cancel: jest.fn(), finished: options.direction === 'reverse' ? new Promise(resolve => { finishExit.push(resolve) }) : Promise.resolve() }))
  Element.prototype.animate = animate
  const onClose = jest.fn()
  const onPreview = jest.fn()
  render(<HeroUIProvider disableAnimation><FolderDocumentSurface folder={folder} sourceElement={sourceElement} onClose={onClose} onPreview={onPreview} /></HeroUIProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'View' }))
  expect(screen.getByLabelText('Documents grid')).toHaveClass('lg:grid-cols-5')
  expect(screen.getByLabelText('Documents grid')).not.toHaveClass('lg:grid-cols-4')
  expect(onPreview).toHaveBeenCalledWith(folder.documents[0])
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(animate.mock.calls.some(([, options]) => options.direction === 'reverse')).toBe(true))
  expect(onClose).not.toHaveBeenCalled()
  finishExit.forEach(finish => finish())
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

test('empty folders show an accessible full-screen empty state', async () => {
  const onClose = jest.fn()
  render(<HeroUIProvider disableAnimation><FolderDocumentSurface folder={{ name: 'Empty', documents: [] }} sourceElement={sourceElement} onClose={onClose} /></HeroUIProvider>)
  expect(await screen.findByRole('dialog')).toHaveClass('!bg-transparent')
  expect(screen.getByText('No documents in this folder yet.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

test('entrance pairs 400ms Genie and blur from zero; exit pairs 400ms blur and 500ms Genie', async () => {
  const calls = []
  Element.prototype.animate = jest.fn((frames, options) => {
    let finish
    const finished = new Promise(resolve => { finish = resolve })
    calls.push({ frames, options, finish })
    return { finished, cancel: jest.fn(finish) }
  })
  const onClose = jest.fn()
  render(<HeroUIProvider disableAnimation><FolderDocumentSurface folder={folder} sourceElement={sourceElement} onClose={onClose} /></HeroUIProvider>)
  await screen.findByRole('dialog')
  expect(calls.filter(call => call.options.direction === 'normal' && call.options.duration === 400)).toHaveLength(1)
  expect(document.querySelectorAll('article')).toHaveLength(1)
  expect(calls.every(call => call.options.delay === 0)).toBe(true)
  expect(calls.filter(call => !call.options.direction)).toHaveLength(1)
  const blurIn = calls.find(call => !call.options.direction)
  expect(blurIn.options.duration).toBe(400)
  expect(blurIn.frames[0].opacity).toBe('0')
  expect(blurIn.frames[1].opacity).toBe(1)
  await act(async () => { calls.forEach(call => call.finish()) })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  const blurOut = calls.filter(call => !call.options.direction)[1]
  expect(blurOut.options.duration).toBe(400)
  expect(blurOut.frames[1].opacity).toBe(0)
  const exit = calls.filter(call => call.options.direction === 'reverse')
  expect(exit).toHaveLength(1)
  expect(exit.every(call => call.options.duration === 500 && call.options.delay === 0)).toBe(true)
  await act(async () => { blurOut.finish() })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { exit.forEach(call => call.finish()) })
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('reduced motion skips the warp in both directions', async () => {
  const original = window.matchMedia
  window.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  Element.prototype.animate = jest.fn()
  const onClose = jest.fn()
  try {
    render(<HeroUIProvider disableAnimation><FolderDocumentSurface folder={folder} sourceElement={sourceElement} onClose={onClose} /></HeroUIProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(Element.prototype.animate).not.toHaveBeenCalled()
  } finally { window.matchMedia = original }
})
