import React from 'react'
import { render, screen } from '@testing-library/react'
import AIAssistant from '@/components/AIAssistant'

let mockState
jest.mock('@/contexts/AIAssistantContext', () => ({ useAIAssistant: () => mockState }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/components/ui/MiraPet', () => ({ __esModule: true, default: ({ isThinking }) => <span role="img" aria-label={isThinking ? 'MIRA thinking' : 'MIRA smiley'} /> }))
jest.mock('@heroui/react', () => ({
  Modal: ({ children }) => <div>{children}</div>,
  ModalContent: ({ children }) => children(),
  ModalHeader: ({ children }) => <header>{children}</header>,
  ModalBody: ({ children }) => <main>{children}</main>,
  ModalFooter: ({ children }) => <footer>{children}</footer>,
  Button: ({ children }) => <button>{children}</button>,
  Input: ({ startContent }) => <div>{startContent}</div>,
  Chip: ({ children }) => <span>{children}</span>,
}))
beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn()
  mockState = { isOpen: true, conversationHistory: [], aiResponse: '', isAiLoading: false, askQuestion: jest.fn(), closeAssistant: jest.fn() }
})
test('header, response and composer use the shared smiley', () => {
  mockState.aiResponse = 'Please retry.'
  render(<AIAssistant />)
  expect(screen.getAllByRole('img', { name: 'MIRA smiley' })).toHaveLength(3)
})
test('loading uses the thinking smiley and conversation replies retain the shared avatar', () => {
  mockState.isAiLoading = true
  mockState.conversationHistory = [{ role: 'assistant', content: 'Checking now.' }]
  render(<AIAssistant />)
  expect(screen.getAllByRole('img', { name: 'MIRA smiley' })).toHaveLength(3)
  expect(screen.getByRole('img', { name: 'MIRA thinking' })).toBeInTheDocument()
})
