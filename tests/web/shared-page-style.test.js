import { render, screen, fireEvent } from '@testing-library/react'
import { SummaryCard, Surface, NativeTable } from '@/components/ui/fernly'
import { KPICard } from '@/components/ui/heroui/Card'
import fs from 'fs'
import path from 'path'

test('summary cards share label/value styling without heading icons or coloured borders', () => {
  render(<SummaryCard as="section" aria-label="Total" label="Total" value="41" />)
  const card = screen.getByRole('region', { name: 'Total' })
  expect(card).toHaveTextContent('41')
  expect(card.querySelector('svg')).toBeNull()
  const css = fs.readFileSync('components/ui/fernly/elements.module.css', 'utf8')
  expect(css).toContain('padding: 24px')
  expect(css).toContain('font-variant-numeric: tabular-nums')
  expect(css).toContain('border: 1px solid var(--color-border')
})

test('interactive summaries retain filtering, keyboard semantics and disabled states', () => {
  const press = jest.fn()
  const { rerender } = render(<SummaryCard isPressable onPress={press} label="Pending" value={4} />)
  fireEvent.click(screen.getByRole('button', { name: 'Pending 4' }))
  expect(press).toHaveBeenCalledTimes(1)
  rerender(<SummaryCard isPressable isDisabled onPress={press} label="Pending" value={4} />)
  expect(screen.getByRole('button')).toBeDisabled()
  fireEvent.click(screen.getByRole('button'))
  expect(press).toHaveBeenCalledTimes(1)
})

test('legacy KPI API delegates to the same summary while retaining subtitle and trend', () => {
  render(<KPICard title="Net Payable" value="₹500" subtitle="This month" trend="up" trendValue="5%" />)
  expect(screen.getByText('Net Payable')).toBeInTheDocument()
  expect(screen.getByText('This month')).toBeInTheDocument()
  expect(screen.getByText('↑ 5%')).toBeInTheDocument()
})

test('native surfaces preserve layout and table semantics', () => {
  render(<Surface className="flex-row overflow-visible"><NativeTable aria-label="Records"><tbody><tr><td>Asha</td></tr></tbody></NativeTable></Surface>)
  expect(screen.getByRole('table', { name: 'Records' })).toHaveTextContent('Asha')
  expect(screen.getByRole('table').parentElement).toHaveClass('overflow-visible', 'flex-row')
})

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}
test('every dashboard route uses shared controls and native tables, not direct library imports', () => {
  const pages = files('app/dashboard').filter(file => /page\.(js|jsx|tsx)$/.test(file))
  expect(pages).toHaveLength(90)
  for (const file of pages) {
    const source = fs.readFileSync(file, 'utf8')
    expect(source).not.toMatch(/from ['"]@heroui\/react['"]|<table\b|<button\b|<input\b/)
  }
  const holidays = fs.readFileSync('app/dashboard/holidays/page.js', 'utf8')
  expect(holidays.match(/<SummaryCard\b/g)).toHaveLength(3)
  expect(holidays).toContain('<Tabs aria-label="Holiday view"')
  expect(holidays).not.toContain('border-l-4')
})
