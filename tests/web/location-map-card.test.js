import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocationMapCard } from '@/components/dashboard/ActionableInsights'

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}))

function setGeolocation(implementation) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: jest.fn(implementation) },
  })
  return navigator.geolocation.getCurrentPosition
}

describe('LocationMapCard', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: { city: 'Bhopal' } }),
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('renders a policy-compliant OpenStreetMap embed after locating the user', async () => {
    setGeolocation((success) => success({
      coords: { latitude: 23.2599, longitude: 77.4126 },
    }))

    render(<LocationMapCard />)

    const map = await screen.findByTitle('Map showing your current location')
    expect(map).toHaveAttribute('src', expect.stringContaining('https://www.openstreetmap.org/export/embed.html?'))
    expect(map).toHaveAttribute('src', expect.stringContaining('marker=23.2599%2C77.4126'))
    expect(map).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')

    await waitFor(() => expect(screen.getByText('Bhopal')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://nominatim.openstreetmap.org/reverse?'),
      expect.objectContaining({ headers: { 'Accept-Language': 'en' } })
    )
  })

  test('explains denied permission and lets the user retry', async () => {
    let attempt = 0
    const getCurrentPosition = setGeolocation((success, error) => {
      attempt += 1
      if (attempt === 1) error({ code: 1 })
      else success({ coords: { latitude: 23.2599, longitude: 77.4126 } })
    })

    render(<LocationMapCard />)

    expect(await screen.findByText(/allow location access/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry location/i }))

    expect(await screen.findByTitle('Map showing your current location')).toBeInTheDocument()
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  test('keeps an accessible external map fallback beside the embed', async () => {
    setGeolocation((success) => success({
      coords: { latitude: 23.2599, longitude: 77.4126 },
    }))

    render(<LocationMapCard />)
    await screen.findByTitle('Map showing your current location')
    await screen.findByText('Bhopal')

    expect(screen.getByRole('link', { name: /open your location in openstreetmap/i })).toHaveAttribute(
      'href',
      expect.stringContaining('https://www.openstreetmap.org/')
    )
  })
})
