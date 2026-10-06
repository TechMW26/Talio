import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import ReportDashboard from '@/components/performance/ReportDashboard'
import { buildEmployeeReportRows, employeeReportActions, employeeDashboardHref } from '@/lib/client/reportInsights'
import { attendanceReportTrend, completedTaskTrend } from '@/lib/client/reportTrends'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/components/ui/FernlyMotion', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }))
jest.mock('@/components/charts/FernlyCharts', () => ({
  FernlyMetricCard: ({ label, value }) => <article>{label}: {value}</article>,
  ResponsiveContainer: () => <div>Chart</div>,
  BarChart: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null, AreaChart: () => null, Area: () => null,
}))

test('employee joins use identifiers, preserve zero scores and do not invent missing attendance', () => {
  const rows = buildEmployeeReportRows([{ id: 'a', name: 'Same name', sessionProductivity: 0 }, { id: 'b', name: 'Same name' }], [{ employeeId:'b', attendanceRate: 100 }], [{ employeeId:'a', overdueTasks:2 }])
  expect(rows[0].attendance).toBeUndefined()
  expect(rows[0].sessionProductivity).toBe(0)
  expect(employeeReportActions(rows).map(row => row.id)).toEqual(['a'])
  expect(employeeDashboardHref('a/b')).toBe('/dashboard/team/members/a%2Fb')
})

test('trend buckets are chronological and use observations only', () => {
  const rows = attendanceReportTrend([
    {date:'2026-10-03', status:'present', workHours:8},
    {date:'2026-10-01', status:'half-day', workHours:4},
    {date:'2026-10-01', status:'absent'},
    {date:'invalid', status:'present'},
  ])
  expect(rows.map(row => row.date)).toEqual(['2026-10-01','2026-10-03'])
  expect(rows[0]).toMatchObject({attendanceRate:25,hours:4})
})

test('completion trends require a recorded completion in the selected range', () => {
  expect(completedTaskTrend([
    {status:'completed'},
    {status:'in-progress',completedAt:'2026-10-02'},
    {status:'completed',completedAt:'2026-09-30'},
    {status:'completed',completedAt:'2026-10-02'},
  ], '2026-10-01', '2026-10-07')).toEqual([{date:'2026-10-02',completed:1}])
})

const props = {
  report: {employeePerformance:[{id:'employee1',name:'Test Member',employeeCode:'T1',department:'Engineering',reviewCount:0,goalsCompleted:0,totalGoals:0,sessionProductivity:null}],departmentPerformance:[],totalReviews:0},
  departments:[{_id:'dept1',name:'Engineering'}], departmentId:'all', teams:[], team:'all', dateRange:{startDate:'2026-10-01',endDate:'2026-10-07'},
  setTeam:jest.fn(), setDateRange:jest.fn(), onExport:jest.fn(), onGenerate:jest.fn(), onRetry:jest.fn(),
}
test('department selection opens a dedicated report and employee links reuse team dashboard', () => {
  render(<ReportDashboard {...props} />)
  fireEvent.change(screen.getByLabelText('Department'), {target:{value:'dept1'}})
  expect(mockPush).toHaveBeenCalledWith('/dashboard/performance/reports/department/dept1')
  expect(screen.getByRole('link',{name:'Test Member'})).toHaveAttribute('href','/dashboard/team/members/employee1')
  expect(screen.getByText('Not reviewed')).toBeInTheDocument()
})
test('errors remain retryable and do not render misleading empty metrics', () => {
  render(<ReportDashboard {...props} report={null} error="Could not load" />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
  fireEvent.click(screen.getByRole('button',{name:'Retry report'}))
  expect(props.onRetry).toHaveBeenCalled()
  expect(screen.queryByText('Attendance rate:')).not.toBeInTheDocument()
})
