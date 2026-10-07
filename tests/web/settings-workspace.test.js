import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SettingsWorkspace from '@/components/settings/SettingsWorkspace'

const Icon = () => <svg aria-hidden="true" />
const tabs = [
  { id: 'company', name: 'Organisation', description: 'Companies and workplace defaults', group: 'Organisation', icon: Icon },
  { id: 'payroll', name: 'Payroll', description: 'Salary and deductions', group: 'Finance', icon: Icon },
  { id: 'mira', name: 'MIRA', description: 'Voice and personal instructions', group: 'Personalisation', icon: Icon },
]
function Workspace({ initial = 'company', available = tabs }) {
  const [active, setActive] = useState(initial)
  return <SettingsWorkspace tabs={available} activeTab={active} onSelect={setActive}><button>Save {active}</button></SettingsWorkspace>
}
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })

test('organisation opens directly and sections retain their existing controls without an overview', () => {
  render(<Workspace />)
  expect(screen.getByRole('heading', { name: 'Organisation' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save company' })).toBeInTheDocument()
  expect(screen.queryByText('All settings')).not.toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Settings sections' })
  fireEvent.click(within(nav).getByRole('button', { name: 'Payroll' }))
  expect(screen.getByRole('heading', { name: 'Payroll' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save payroll' })).toBeInTheDocument()
  expect(within(nav).getByRole('button', { name: 'Payroll' })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(within(nav).getByRole('button', { name: 'Organisation' }))
  expect(screen.getByRole('heading', { name: 'Organisation' })).toBeInTheDocument()
})

test('search matches descriptions, handles no matches and clears', () => {
  render(<Workspace />)
  const search = screen.getByRole('textbox', { name: 'Search settings' })
  fireEvent.change(search, { target: { value: 'deductions' } })
  const nav = screen.getByRole('navigation', { name: 'Settings sections' })
  expect(within(nav).getByRole('button', { name: 'Payroll' })).toBeInTheDocument()
  expect(within(nav).queryByRole('button', { name: 'Organisation' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save company' })).toBeInTheDocument()
  fireEvent.change(search, { target: { value: 'unknown option' } })
  expect(screen.getByText('No settings found')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(search).toHaveValue('')
  expect(screen.getByText('Companies and workplace defaults')).toBeInTheDocument()
})

test('mobile picker switches sections and respects role-filtered options', () => {
  render(<Workspace available={[tabs[2]]} initial="mira" />)
  expect(screen.getByRole('heading', { name: 'MIRA' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Payroll' })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox')).toHaveValue('mira')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(screen.queryByRole('option', { name: 'All settings' })).not.toBeInTheDocument()
})

test('existing sections, permission filters, deep links and saves remain wired', () => {
  const fs = require('fs')
  const page = fs.readFileSync('app/dashboard/settings/page.js', 'utf8')
  const css = fs.readFileSync('components/settings/SettingsWorkspace.module.css', 'utf8')
  for (const id of ['company', 'recruitment', 'induction', 'geofencing', 'attendance-machines', 'payroll', 'notifications', 'productivity', 'mira']) {
    expect(page).toContain(`activeTab === '${id}'`)
  }
  expect(page).toContain('tabs.some((tab) => tab.id === requestedTab)')
  expect(page).toContain("isFeatureEnabled('attendanceMachines')")
  expect(page).toContain('saveCompanySettings')
  expect(page).toContain('<SettingsWorkspace')
  expect(page).toContain("useState('company')")
  expect(page).toContain("tabs.some((tab) => tab.id === 'company') ? 'company' : tabs[0]?.id")
  expect(page).not.toContain('Workspace controls')
  expect(page).not.toContain('<Heading1')
  expect(page).not.toContain("setActiveTab('overview')")
  expect(css).toContain('position: sticky')
  expect(css).toContain('max-height: calc(100dvh - 112px)')
  expect(css).toContain('overflow-y: auto')
  expect(css).toContain('border-radius: 10px !important')
  expect(css).not.toContain(':hover')
})
