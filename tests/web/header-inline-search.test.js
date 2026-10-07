import { act, fireEvent, render, screen } from '@testing-library/react'
import HeaderSearch from '@/components/HeaderSearch'
import useAuthedSWR from '@/hooks/useAuthedSWR'

const push = jest.fn(), openWidget = jest.fn(), mutate = jest.fn()
let response
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
jest.mock('@/contexts/ChatWidgetContext', () => ({ useChatWidget: () => ({ openWidget }) }))
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/components/ui/AIActivityBeam', () => ({ __esModule: true, default: ({ active, borderRadius }) => <span data-testid="edge-light" data-active={active} data-radius={borderRadius} /> }))
jest.mock('framer-motion', () => ({ useReducedMotion: () => true, AnimatePresence: ({ children }) => children, motion: { div: ({ initial, animate, exit, transition, ...props }) => <div {...props} /> } }))
beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  response = { data: { success: true, data: { pages: [{ title: 'Projects', link: '/dashboard/projects' }, { title: 'Messages', link: '/dashboard/chat' }] } }, mutate, isLoading: false }
  useAuthedSWR.mockImplementation(key => key ? response : { mutate })
})
afterEach(() => { jest.useRealTimers() })
const type = query => {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
  act(() => jest.advanceTimersByTime(300))
}

test('focus and shortcut expand the same input; search is debounced and keeps edge lighting', () => {
  const view = render(<HeaderSearch />)
  const input = screen.getByRole('combobox', { name: 'Search Talio' })
  expect(input).toHaveAttribute('aria-expanded', 'false')
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  expect(document.activeElement).toBe(input)
  expect(input).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('edge-light')).toHaveAttribute('data-active', 'false')
  expect(input).toHaveAttribute('placeholder', 'Search Talio…')
  expect(screen.getByText('AI Search')).toBeTruthy()
  fireEvent.change(input, { target: { value: 'proj' } })
  expect(screen.getByRole('status')).toHaveTextContent('Searching')
  expect(screen.getByTestId('edge-light')).toHaveAttribute('data-active', 'true')
  expect(useAuthedSWR).not.toHaveBeenCalledWith('/api/search?q=proj', expect.anything())
  act(() => jest.advanceTimersByTime(300))
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/search?q=proj', { keepPreviousData: false, refreshInterval: 0 })
  expect(screen.getByRole('combobox')).toBe(input)
  expect(view.container.querySelectorAll('input')).toHaveLength(1)
  expect(screen.getByTestId('edge-light')).toHaveAttribute('data-active', 'false')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(screen.getByRole('option', { name: 'Projects Page' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(push).toHaveBeenCalledWith('/dashboard/projects')
  expect(input).toHaveValue('')
  expect(input).toHaveAttribute('aria-expanded', 'false')
})

test('Escape, close button and outside click collapse without another search surface', () => {
  render(<HeaderSearch />)
  const input = screen.getByRole('combobox')
  act(() => input.focus())
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(input).toHaveAttribute('aria-expanded', 'false')
  act(() => input.focus())
  fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
  expect(input).toHaveAttribute('aria-expanded', 'false')
  act(() => input.focus())
  fireEvent.pointerDown(document.body)
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('listbox')).toBeNull()
})

test('results support existing chat popup, unavailable retry and honest empty state', () => {
  const view = render(<HeaderSearch />)
  type('message')
  fireEvent.click(screen.getByRole('option', { name: 'Messages Page' }))
  expect(openWidget).toHaveBeenCalledWith('button')
  expect(push).not.toHaveBeenCalled()
  response = { error: new Error('offline'), mutate }
  type('broken')
  fireEvent.click(screen.getByRole('button', { name: 'Retry search' }))
  expect(mutate).toHaveBeenCalled()
  expect(screen.queryByText(/No results/)).toBeNull()
  response = { data: { success: true, data: {} }, mutate }
  view.rerender(<HeaderSearch />)
  expect(screen.getByText('No results for “broken”.')).toBeTruthy()
})

test('glow follows the resolved control radius, including responsive changes', () => {
  const computed = jest.spyOn(window, 'getComputedStyle').mockReturnValue({ borderTopLeftRadius: '11px' })
  render(<HeaderSearch />)
  expect(screen.getByTestId('edge-light')).toHaveAttribute('data-radius', '11')
  computed.mockReturnValue({ borderTopLeftRadius: '13px' })
  fireEvent(window, new Event('resize'))
  expect(screen.getByTestId('edge-light')).toHaveAttribute('data-radius', '13')
  computed.mockRestore()
})
