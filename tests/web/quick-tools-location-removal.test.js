import { render, screen } from '@testing-library/react'
import ActionableInsights from '@/components/dashboard/ActionableInsights'

jest.mock('@/contexts/FocusTimerContext', () => ({ useFocusTimer: () => ({ duration: 25, running: false, done: false, pct: 0, mins: '25', secs: '00', alarming: false, toggle: jest.fn(), reset: jest.fn(), TIMER_PRESETS: [25] }) }))
jest.mock('@/contexts/TicTacToeContext', () => ({ useTicTacToe: () => ({ openInvite: jest.fn(), hasIncomingInvite: false }) }))
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ isDarkMode: false }) }))
jest.mock('@/components/dashboard/LocationGlobe', () => () => <div data-testid="location-globe" />)

const originalFetch = global.fetch
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
let getCurrentPosition
beforeEach(() => {
  localStorage.clear()
  getCurrentPosition = jest.fn()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ history: [] }) }))
})
afterEach(() => {
  global.fetch = originalFetch
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation)
  else delete navigator.geolocation
  localStorage.clear()
})

test.each([false, true])('Quick Tools omits location without starting geolocation (vertical=%s)', vertical => {
  const { container } = render(<ActionableInsights vertical={vertical} />)
  expect(screen.queryByText('Your Location')).not.toBeInTheDocument()
  expect(screen.queryByTestId('location-card')).not.toBeInTheDocument()
  expect(screen.queryByTestId('location-globe')).not.toBeInTheDocument()
  expect(getCurrentPosition).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByText('Focus Timer')).toBeVisible()
  expect(screen.getByText('Calculator')).toBeVisible()
  expect(screen.getByText('Quick Note')).toBeVisible()
  expect(screen.getByText('Tic-Tac-Toe')).toBeVisible()
  if (vertical) expect(screen.getByRole('region', { name: 'Scrollable quick tools' })).toBeVisible()
  else expect(container.querySelector('.lg\\:grid-cols-3')).not.toBeNull()
})
