import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import * as Charts from 'recharts'
import { styleChartTree, TaskDistribution, FernlyBars } from '@/components/charts/FernlyCharts'
import MemberOverview from '@/app/dashboard/team/members/[id]/MemberOverview'
jest.mock('framer-motion', () => ({ useReducedMotion: () => true }))
test('theme preserves chart data, data keys, handlers and series colors', () => {
  const rows = [{ name: 'One', value: 10 }], click = jest.fn()
  const tree = styleChartTree(<Charts.BarChart data={rows} onClick={click}><Charts.Bar dataKey="value" fill="#ef4444" /><Charts.XAxis dataKey="name" /><Charts.Tooltip formatter={click} /></Charts.BarChart>, true)
  expect(tree.type).toBe(Charts.BarChart)
  expect(tree.props.data).toBe(rows)
  expect(tree.props.onClick).toBe(click)
  expect(tree.props.children[0].props).toMatchObject({ dataKey: 'value', fill: '#ef4444', isAnimationActive: false, radius: 999 })
  expect(tree.props.children[2].props.formatter).toBe(click)
})
test('custom axis ticks and horizontal bar geometry survive styling', () => {
  const tick = () => null
  const tree = styleChartTree(<Charts.BarChart layout="vertical"><Charts.Bar radius={[0, 4, 4, 0]} /><Charts.YAxis tick={tick} /></Charts.BarChart>)
  expect(tree.props.layout).toBe('vertical')
  expect(tree.props.children[0].props.radius).toEqual(999)
  expect(tree.props.children[1].props.tick).toBe(tick)
})

test('Fernly pills keep real proportions, sanitize invalid values and support focus', () => {
  render(<FernlyBars data={[{ name: 'Open', value: 10 }, { name: 'Done', value: 5 }, { name: 'Invalid', value: Infinity }]} />)
  expect(screen.getByRole('button', { name: 'Open: 10 tasks' })).toHaveStyle({ height: '100%' })
  const half = screen.getByRole('button', { name: 'Done: 5 tasks' })
  expect(half).toHaveStyle({ height: '50%' })
  expect(screen.getByRole('img', { name: 'Invalid: 0 tasks' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Invalid: 0 tasks' })).not.toBeInTheDocument()
  fireEvent.focus(half)
  expect(screen.getByText('5')).toBeInTheDocument()
})

test('member portrait uses real image and falls back when image fails', () => {
  render(<MemberOverview employee={{ firstName: 'Test', lastName: 'User', profilePicture: '/photo.jpg', employeeCode: 'T1' }} />)
  const photo = screen.getByRole('img', { name: 'Test User' })
  expect(photo).toHaveAttribute('src', '/photo.jpg')
  fireEvent.error(photo)
  expect(screen.getByLabelText('No profile photo')).toHaveTextContent('TU')
  expect(screen.getByRole('heading', { name: 'Test User' })).toBeInTheDocument()
})
test('empty task data is honest and does not show fabricated bars', () => {
  render(<TaskDistribution stats={{ total: 0, completed: 0 }} />)
  expect(screen.getByText(/No task activity yet/)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '0% completed' })).toBeInTheDocument()
  expect(screen.getByText('0 of 0 tasks')).toBeInTheDocument()
})
