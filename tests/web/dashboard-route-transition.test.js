import { render, screen } from '@testing-library/react'
import DashboardRouteTransition from '@/components/ui/DashboardRouteTransition'

let mockIsNavigating = false
let mockPathname = '/dashboard'

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

jest.mock('@/contexts/PageTransitionContext', () => ({
  usePageTransition: () => ({ isNavigating: mockIsNavigating }),
}))

describe('DashboardRouteTransition', () => {
  beforeEach(() => {
    mockIsNavigating = false
    mockPathname = '/dashboard'
  })

  test('keeps route content mounted and exposes an idle transition state', () => {
    const { container } = render(
      <DashboardRouteTransition><p>Dashboard content</p></DashboardRouteTransition>
    )

    const stage = container.querySelector('.dashboard-route-stage')
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    expect(stage).toHaveAttribute('data-navigation-state', 'idle')
    expect(stage).not.toHaveClass('is-navigating')
    expect(container.querySelector('.dashboard-route-veil')).not.toHaveClass('is-active')
  })

  test('adds the non-blocking futuristic transition layer while navigating', () => {
    mockIsNavigating = true

    const { container } = render(
      <DashboardRouteTransition><p>Current route remains visible</p></DashboardRouteTransition>
    )

    const stage = container.querySelector('.dashboard-route-stage')
    expect(stage).toHaveAttribute('data-navigation-state', 'loading')
    expect(stage).toHaveClass('is-navigating')
    expect(container.querySelector('.dashboard-route-veil')).toHaveClass('is-active')
    expect(container.querySelector('.dashboard-route-grid')).toBeInTheDocument()
    expect(container.querySelector('.dashboard-route-orb')).toBeInTheDocument()
    expect(container.querySelector('.dashboard-route-scan')).toBeInTheDocument()
    expect(screen.getByText('Current route remains visible')).toBeInTheDocument()
  })
})

