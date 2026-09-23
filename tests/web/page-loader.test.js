import React from 'react'
import { render, screen } from '@testing-library/react'
import Loader, { PageLoader } from '@/components/ui/Loader'

test('page loader centers inside viewport-sized content without an overlay', () => {
  render(<PageLoader message="Loading profile" />)
  const loader = screen.getByRole('status', { name: 'Loading profile' })
  expect(loader).toHaveClass('items-center', 'justify-center', 'min-h-[calc(100vh-7rem)]')
  expect(loader).not.toHaveClass('fixed')
})

test('inline loaders retain their small size', () => {
  const { container } = render(<Loader size="xs" />)
  expect(container.querySelector('.talio-loader')).toHaveStyle({ width: '16px', height: '16px' })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
