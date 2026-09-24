import { render, screen, fireEvent } from '@testing-library/react'
import { ChatWidgetProvider, useChatWidget } from '@/contexts/ChatWidgetContext'
function Probe({ navigate }) {
  const { isWidgetOpen } = useChatWidget()
  return <><a href="/dashboard/chat" onClick={navigate}>Messages</a><div>{isWidgetOpen ? 'Overlay open' : 'Overlay closed'}</div></>
}
beforeEach(() => { window.matchMedia = jest.fn(() => ({ matches: false })) })
afterEach(() => { delete window.electronAPI })
test('desktop links open only the overlay without firing route handlers', () => {
  window.electronAPI = { nativePip: true }
  const navigate = jest.fn()
  render(<ChatWidgetProvider><Probe navigate={navigate} /></ChatWidgetProvider>)
  fireEvent.click(screen.getByText('Messages'))
  expect(screen.getByText('Overlay open')).toBeInTheDocument()
  expect(navigate).not.toHaveBeenCalled()
})
test('mobile links retain their normal route handler', () => {
  const navigate = jest.fn(event => event.preventDefault())
  render(<ChatWidgetProvider><Probe navigate={navigate} /></ChatWidgetProvider>)
  fireEvent.click(screen.getByText('Messages'))
  expect(screen.getByText('Overlay closed')).toBeInTheDocument()
  expect(navigate).toHaveBeenCalledTimes(1)
})
