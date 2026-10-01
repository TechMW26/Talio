import { render } from '@testing-library/react'
import BackIcon from '@/components/ui/BackIcon'
import fs from 'fs'
import path from 'path'

test('back icon uses the supplied decorative PNG without intercepting navigation', () => {
  const { container } = render(<BackIcon className="w-4 h-4" />)
  const icon = container.querySelector('img')
  expect(icon).toHaveAttribute('src', '/icons/back.png')
  expect(icon).toHaveAttribute('alt', '')
  expect(icon).toHaveAttribute('aria-hidden', 'true')
  expect(icon).toHaveAttribute('draggable', 'false')
  expect(icon).toHaveClass('talio-back-icon', 'w-4', 'h-4')
  expect(icon).toHaveStyle({ transform: 'scaleX(-1)' })
  expect(fs.existsSync(path.join(process.cwd(), 'public/icons/back.png'))).toBe(true)
})

test('back icon supports explicit white inversion and existing size props', () => {
  const { container } = render(<BackIcon white size={16} />)
  expect(container.querySelector('img')).toHaveStyle({ filter: 'invert(1)', width: '16px', height: '16px', transform: 'scaleX(-1)' })
})
