import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocationMapCard } from '@/components/dashboard/ActionableInsights'

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}))

jest.mock('@/components/dashboard/LocationGlobe', () => {
  return function MockLocationGlobe({ lat, lon, isDarkMode }) {
    return (
      <div
        role="img"
        aria-label="3D earth showing your current location"
        data-testid="location-globe"
        data-lat={lat}
        data-lon={lon}
        data-dark={String(isDarkMode)}
      />
    )
  }
})

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

  test('renders the 3D earth after locating the user', async () => {
    setGeolocation((success) => success({
      coords: { latitude: 23.2599, longitude: 77.4126 },
    }))

    render(<LocationMapCard />)

    const globe = await screen.findByTestId('location-globe')
    expect(globe).toHaveAttribute('data-lat', '23.2599')
    expect(globe).toHaveAttribute('data-lon', '77.4126')

    await waitFor(() => expect(screen.getByText('Bhopal')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://nominatim.openstreetmap.org/reverse?'),
      expect.objectContaining({ headers: { 'Accept-Language': 'en' } })
    )
  })

  test('stretches with its grid row and blends every globe edge into the card', async () => {
    setGeolocation((success) => success({
      coords: { latitude: 23.2599, longitude: 77.4126 },
    }))

    render(<LocationMapCard />)

    await screen.findByTestId('location-globe')
    const card = screen.getByTestId('location-card')
    const frame = screen.getByTestId('location-globe-frame')
    const edgeFade = screen.getByTestId('location-edge-fade')

    expect(card).toHaveClass('min-h-[260px]', 'self-stretch', 'rounded-2xl', 'overflow-hidden')
    expect(card).not.toHaveClass('h-[168px]', 'sm:h-[176px]', 'lg:h-[184px]')
    expect(card).toHaveStyle({ backgroundColor: 'var(--color-bg-card, #ffffff)' })
    expect(frame).toHaveClass('overflow-hidden')
    expect(edgeFade.style.background).toContain('linear-gradient(90deg')
    expect(edgeFade.style.background).toContain('linear-gradient(180deg')
    expect(edgeFade.style.background).toContain('var(--color-bg-card, #ffffff)')
    expect(edgeFade.style.background).toContain('transparent 24%')
    expect(edgeFade.style.background).toContain('transparent 76%')
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

    expect(await screen.findByTestId('location-globe')).toBeInTheDocument()
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })
})
