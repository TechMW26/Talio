import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NativeButton, NativeInput, NativeSelect, Heading2, Input, SelectItem, Tabs, Autocomplete } from '@/components/ui/fernly'

jest.mock('@heroui/react', () => {
  const React = require('react')
  return {
    Input: React.forwardRef(({ classNames, ...props }, ref) => <input {...props} ref={ref} data-wrapper={classNames.inputWrapper} />),
    Autocomplete: React.forwardRef(({ classNames, ...props }, ref) => <input {...props} ref={ref} data-end-content={classNames.endContentWrapper} />),
    SelectItem: Object.assign(() => null, { getCollectionNode: () => 'collection' }),
    Tabs: React.forwardRef(({ variant, color, radius, classNames, onSelectionChange }, ref) => <div ref={ref} data-testid="tabs" data-variant={variant} data-color={color} data-radius={radius} data-cursor={classNames.cursor}><button onClick={() => onSelectionChange('approved')}>Approved</button></div>),
  }
})

test('shared tabs enforce the standard solid pill and preserve selection and slot additions', () => {
  const select = jest.fn(), ref = createRef()
  render(<Tabs ref={ref} variant="underlined" color="default" radius="none" onSelectionChange={select} classNames={{ cursor: 'existing-cursor' }} />)
  expect(ref.current).toBe(screen.getByTestId('tabs'))
  expect(ref.current).toHaveAttribute('data-variant', 'solid')
  expect(ref.current).toHaveAttribute('data-color', 'primary')
  expect(ref.current).toHaveAttribute('data-radius', 'full')
  expect(ref.current.dataset.cursor).toContain('existing-cursor')
  fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
  expect(select).toHaveBeenCalledWith('approved')
})
jest.mock('@/components/ui/HeroModal', () => ({ __esModule: true, default: () => null }))

test('searchable dropdowns preserve caller slots and share the arrow gutter', () => {
  render(<Autocomplete aria-label="Search department" classNames={{ endContentWrapper: 'existing-end-content' }} />)
  expect(screen.getByRole('textbox').dataset.endContent).toContain('existing-end-content')
  const source = require('fs').readFileSync('components/ui/fernly/index.js', 'utf8')
  expect(source).toContain("endContentWrapper: 'dropdownEndContent'")
  const css = require('fs').readFileSync('components/ui/fernly/elements.module.css', 'utf8')
  expect(css).toContain('margin-inline: 0 !important')
  expect(css).toContain('padding-inline-end: var(--talio-select-arrow-inset, 16px)')
})

test('global dropdown spacing covers native and shared selects without changing listboxes', () => {
  const css = require('fs').readFileSync('app/globals.css', 'utf8')
  expect(css).toContain('--talio-select-arrow-inset: 16px')
  expect(css).toContain('inset-inline-end: var(--talio-select-arrow-inset)')
  expect(css).toContain('select:not([multiple]):is(:not([size]), [size="1"])')
  expect(css).toContain('background-position: right var(--talio-select-arrow-inset) center')
  expect(css).toContain('background-position: left var(--talio-select-arrow-inset) center')
  expect(css).toContain('padding-inline-end: calc(var(--talio-select-arrow-inset) + 24px)')
})

test('native button preserves disabled, click, type, class and ref behavior', () => {
  const ref = createRef(), click = jest.fn()
  const { rerender } = render(<NativeButton ref={ref} type="button" className="existing-placement" onClick={click}>Save</NativeButton>)
  expect(ref.current.tagName).toBe('BUTTON')
  expect(ref.current.className).toContain('existing-placement')
  fireEvent.click(ref.current)
  expect(click).toHaveBeenCalledTimes(1)
  rerender(<NativeButton disabled onClick={click}>Save</NativeButton>)
  fireEvent.click(screen.getByRole('button'))
  expect(click).toHaveBeenCalledTimes(1)
})
test('clickable screenshot and member cards opt out of the shared pill radius', () => {
  const fs = require('fs')
  render(<NativeButton data-shape="card">Preview</NativeButton>)
  expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('data-shape', 'card')
  const css = fs.readFileSync('components/ui/fernly/elements.module.css', 'utf8')
  expect(css).toMatch(/\.button\.button\[data-shape="card"\]\s*\{\s*border-radius:\s*14px;/)
  const productivity = fs.readFileSync('app/dashboard/productivity/page.js', 'utf8')
  expect(productivity.match(/data-shape="card"/g)).toHaveLength(2)
  const member = fs.readFileSync('app/dashboard/team/members/[id]/MemberProductivity.js', 'utf8')
  expect(member).toContain('data-shape="card"')
})
test('native form semantics and heading level remain unchanged', () => {
  const change = jest.fn()
  render(<><Heading2>Details</Heading2><NativeInput aria-label="Name" defaultValue="A" onChange={change} /><NativeSelect aria-label="Department" defaultValue="tech"><option value="tech">Tech</option></NativeSelect></>)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B' } })
  expect(change).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('combobox').value).toBe('tech')
  expect(screen.getByRole('heading', { level: 2 })).toBeTruthy()
})
test('slot styles preserve caller additions and collection metadata', () => {
  render(<Input aria-label="Styled" classNames={{ inputWrapper: 'existing-field' }} />)
  expect(screen.getByRole('textbox').dataset.wrapper).toContain('existing-field')
  expect(SelectItem.getCollectionNode()).toBe('collection')
})

test('shared controls remove hover classes without dropping focus or brand styling', () => {
  render(<NativeButton className="bg-blue-600 hover:bg-blue-500 dark:hover:shadow-lg group-hover:text-white focus-visible:ring-2">Stable</NativeButton>)
  const classes = screen.getByRole('button').className
  expect(classes).toContain('bg-blue-600')
  expect(classes).toContain('focus-visible:ring-2')
  expect(classes).not.toContain('hover:')
})

test('actions previously revealed on hover remain visible without hover effects', () => {
  render(<NativeButton className="opacity-0 group-hover:opacity-100">Remove</NativeButton>)
  expect(screen.getByRole('button').className).toContain('opacity-100')
  expect(screen.getByRole('button').className).not.toContain('opacity-0')
})

test('project navigation reuses shared tabs instead of bespoke bordered pill buttons', () => {
  const fs = require('fs')
  const source = fs.readFileSync('app/dashboard/projects/[projectId]/page.js', 'utf8')
  const navigation = source.slice(source.indexOf('{/* Tabs */}'), source.indexOf('{/* Overview Tab'))
  expect(navigation).toContain('<Tabs aria-label="Project sections" selectedKey={activeTab} onSelectionChange={setActiveTab}')
  expect(navigation).toContain('<Tab key={tab.id} title={tab.label} />')
  expect(navigation).not.toContain('<NativeButton')
  expect(navigation).not.toContain('border-b-2')
  expect(navigation).not.toContain('<tab.icon')
})

test.each([
  'app/dashboard/leave/approvals/page.js',
  'app/dashboard/leave/requests/page.js',
  'app/dashboard/admin/live-users/page.js',
  'app/dashboard/employees/add/page.js',
  'app/dashboard/performance/my-performance/page.js',
  'app/dashboard/settings/notifications/page.js',
  'components/NotificationManagement.js',
  'components/employees/ResignationPanel.js',
  'components/recruitment/ManpowerRequests.js',
  'components/tasks/TaskAssignment.js',
  'app/superadmin/companies/[id]/page.js',
  'app/superadmin/companies/new/page.js',
  'app/superadmin/security/page.js',
])('%s reuses standard tabs rather than curved underline selectors', file => {
  const source = require('fs').readFileSync(file, 'utf8')
  expect(source).toContain('<Tabs aria-label=')
  expect(source).not.toContain('border-b-2')
})
