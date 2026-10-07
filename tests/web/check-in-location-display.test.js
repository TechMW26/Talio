import { render, screen, fireEvent } from '@testing-library/react'
import fs from 'fs'
import LocationAccessStatus from '@/components/attendance/LocationAccessStatus'

test('shows an available address even when geofencing is disabled', () => {
  render(<LocationAccessStatus showLocation location={{ address: 'Bhopal, Madhya Pradesh', latitude: 23.2599, longitude: 77.4126 }} />)
  expect(screen.getByText(/Fetched location:/).parentElement).toHaveTextContent('Bhopal, Madhya Pradesh')
})

test('falls back to fetched coordinates and preserves accuracy and retry', () => {
  const retry = jest.fn()
  render(<LocationAccessStatus showLocation geofence={{ enabled: true }} permissionStatus="granted" location={{ latitude: 0, longitude: 77.4126, accuracy: 20 }} onRetry={retry} />)
  expect(screen.getByRole('status')).toHaveTextContent('0.00000, 77.41260')
  expect(screen.getByRole('status')).toHaveTextContent('Location ready (20m accuracy).')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledTimes(1)
})

test.each([null, {}, { latitude: null, longitude: null }, { latitude: '', longitude: '' }, { latitude: 95, longitude: 77 }])('unavailable or invalid data is not shown as a location: %p', location => {
  const { container } = render(<LocationAccessStatus showLocation location={location} />)
  expect(container).toBeEmptyDOMElement()
})

test('existing consumers retain their location-detail opt-in and denied state', () => {
  const { rerender } = render(<LocationAccessStatus location={{ address: 'Bhopal' }} />)
  expect(screen.queryByText(/Fetched location:/)).toBeNull()
  rerender(<LocationAccessStatus showLocation geofence={{ enabled: true }} permissionStatus="denied" onRetry={() => {}} />)
  expect(screen.getByRole('status')).toHaveTextContent('Location access is blocked')
  expect(screen.queryByText(/Fetched location:/)).toBeNull()
})

test('punch cards are explicitly placed side by side, with location underneath', () => {
  const css = fs.readFileSync('components/widgets/CheckInOutWidget.module.css', 'utf8')
  expect(css).toContain('.arrival { grid-column: 1; grid-row: 1; }')
  expect(css).toContain('.departure { grid-column: 2; grid-row: 1; }')
  expect(css).toContain('.location { grid-column: 1 / -1; grid-row: 3; }')
  expect(fs.readFileSync('components/widgets/CheckInOutWidget.js', 'utf8')).toContain('showLocation')
})
