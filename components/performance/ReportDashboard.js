'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FernlyMetricCard, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from '@/components/charts/FernlyCharts'
import { buildEmployeeReportRows, employeeReportActions, employeeDashboardHref } from '@/lib/client/reportInsights'
import FernlyMotion from '@/components/ui/FernlyMotion'
import styles from './ReportDashboard.module.css'

export default function ReportDashboard({ report, attendance, tasks, departmentId, departments, teams, team, setTeam, dateRange, setDateRange, onExport, onGenerate, generating, aiInsights, loading, error, onRetry }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [attentionOnly, setAttentionOnly] = useState(false)
  const rows = useMemo(() => buildEmployeeReportRows(report?.employeePerformance, attendance?.employeeBreakdown, tasks?.employeeBreakdown), [report, attendance, tasks])
  const actions = useMemo(() => employeeReportActions(rows), [rows])
  const filtered = (attentionOnly ? actions : rows).filter(row => `${row.name} ${row.employeeCode || ''} ${row.department}`.toLowerCase().includes(search.toLowerCase()))
  const lastPage = Math.max(0, Math.ceil(filtered.length / 20) - 1)
  const currentPage = Math.min(page, lastPage)
  const dept = departments.find(item => String(item._id) === String(departmentId))
  const a = attendance?.summary, t = tasks?.summary
  const percent = value => value == null ? '—' : `${value}%`
  function goDepartment(id) { router.push(id === 'all' ? '/dashboard/performance/reports' : `/dashboard/performance/reports/department/${encodeURIComponent(id)}`) }
  return <FernlyMotion className={styles.page}>
    <header className={styles.header}><div><p>{departmentId !== 'all' ? <Link href="/dashboard/performance/reports">Performance / Department</Link> : 'Workforce intelligence'}</p><h1>{departmentId !== 'all' ? `${dept?.name || 'Department'} performance` : 'Performance overview'}</h1><p>Understand the signals. Review the people behind them.</p></div><div className={styles.actions}><button disabled={!report || loading} onClick={onExport}>Export Excel</button><button disabled={!report || loading || generating} onClick={onGenerate}>{generating ? 'Generating…' : 'Generate AI insights'}</button></div></header>
    <div className={styles.filters}>
      <label>From<input type="date" value={dateRange.startDate} max={dateRange.endDate} onChange={e => e.target.value && setDateRange(prev => ({...prev,startDate:e.target.value}))} /></label>
      <label>To<input type="date" value={dateRange.endDate} min={dateRange.startDate} max={new Date().toLocaleDateString('en-CA')} onChange={e => e.target.value && setDateRange(prev => ({...prev,endDate:e.target.value}))} /></label>
      <label>Department<select value={departmentId} onChange={e => goDepartment(e.target.value)}><option value="all">All permitted departments</option>{departments.map(department => <option key={department._id} value={department._id}>{department.name}</option>)}</select></label>
      {teams.length > 0 && <label>Team<select value={team} onChange={e => setTeam(e.target.value)}><option value="all">All permitted teams</option>{teams.map(item => <option key={item._id} value={item._id}>{item.teamName}</option>)}</select></label>}
    </div>
    {error && <div className={styles.card} role="alert"><p>{error}</p><button onClick={onRetry}>Retry report</button></div>}
    {loading ? <div className={styles.empty} role="status">Loading performance data…</div> : report && <>
      <div className={styles.metrics}>
        <FernlyMetricCard label="Attendance rate" value={percent(a?.attendanceRate)} values={(attendance?.dailyTrend || []).map(day => day.attendanceRate)} note="Trend: recorded attendance by day" />
        <FernlyMetricCard label="Tasks completed" value={t?.completedTasks ?? '—'} values={(tasks?.dailyTrend || []).map(day => day.completed)} note="Trend: recorded completion dates" />
        <FernlyMetricCard label="On-time delivery" value={percent(t?.onTimeDeliveryRate)} note="Completed tasks in selected range" />
        <FernlyMetricCard label="Productivity score" value={percent(report.sessionProductivityScore)} note="Analyzed sessions · selected range" />
      </div>
      <div className={styles.columns}>
        <section className={styles.card} data-fernly-element><h2>Attendance by weekday</h2><p>Recorded attendance in the selected period, grouped by weekday.</p><div className={styles.plot}>{attendance?.dayOfWeekBreakdown?.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={attendance.dayOfWeekBreakdown}><CartesianGrid /><XAxis dataKey="day" tickFormatter={day => day.slice(0,3)} /><YAxis domain={[0,100]} unit="%" /><Tooltip /><Area name="Attendance %" type="monotone" dataKey="attendanceRate" stroke="#3b82f6" /></AreaChart></ResponsiveContainer> : <p className={styles.empty}>No attendance observations.</p>}</div></section>
        <section className={styles.card} data-fernly-element><h2>Task distribution</h2><p>Where assigned work stands in the selected period.</p><div className={styles.plot}>{tasks?.statusBreakdown?.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={tasks.statusBreakdown}><CartesianGrid /><XAxis dataKey="status" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="Tasks" fill="#3b82f6" /></BarChart></ResponsiveContainer> : <p className={styles.empty}>No task observations.</p>}</div></section>
      </div>
      <section className={styles.card} data-fernly-element><div className={styles.sectionHeader}><div><h2>Needs attention</h2><p>Review these signals with the employee; they are not automatic performance judgments.</p></div><button onClick={() => { setAttentionOnly(!attentionOnly); setPage(0) }}>{attentionOnly ? 'Show all employees' : `Filter ${actions.length} employees`}</button></div><div className={styles.queue}>{actions.slice(0,4).map(row => <Link key={row.id} href={employeeDashboardHref(row.id)}><span>{row.name}<small>{row.reasons.join(' · ')}</small></span><b>Review →</b></Link>)}</div>{!actions.length && <p className={styles.empty}>No actionable flags in the available data.</p>}</section>
      {departmentId === 'all' && <section className={styles.card} data-fernly-element><h2>Explore departments</h2><p>Open a dedicated report with an employee-by-employee breakdown.</p><div className={styles.departments}>{departments.map(item => <Link key={item._id} href={`/dashboard/performance/reports/department/${encodeURIComponent(item._id)}`}><strong>{item.name}</strong><small>Open department performance →</small></Link>)}</div></section>}
      <section className={styles.card} data-fernly-element><div className={styles.sectionHeader}><div><h2>Employee breakdown</h2><p>Attendance and tasks use the selected range. Reviews and goals are current totals.</p></div><input aria-label="Search report employees" placeholder="Search employees…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></div>
        <div className={styles.table}><table><thead><tr>{['Employee','Attendance','Completed / assigned','Overdue','Productivity','Goals','Reviews'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.slice(currentPage*20,currentPage*20+20).map(row => <tr key={row.id}><td><Link href={employeeDashboardHref(row.id)}>{row.name}</Link><small>{row.employeeCode} · {row.department}</small></td><td>{row.attendance?.expectedDays > 0 ? percent(row.attendance.attendanceRate) : '—'}</td><td>{row.tasks ? `${row.tasks.completedTasks} / ${row.tasks.totalTasks}` : '—'}</td><td>{row.tasks?.overdueTasks ?? '—'}</td><td>{percent(row.sessionProductivity)}</td><td>{row.goalsCompleted} / {row.totalGoals}</td><td>{row.reviewCount ? `${row.avgRating} / 5 (${row.reviewCount})` : 'Not reviewed'}</td></tr>)}</tbody></table></div>
        {!filtered.length && <p className={styles.empty}>No employees match these filters.</p>}<div className={styles.pagination}><span>{filtered.length} employees</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage-1)}>Previous</button><span>{currentPage+1} / {lastPage+1}</span><button disabled={currentPage >= lastPage} onClick={() => setPage(currentPage+1)}>Next</button></div>
      </section>
      <details className={styles.card}><summary>Reviews, goals and additional analysis</summary><p>Current totals across available reviews and goals, not limited to the attendance date range.</p><div className={styles.metrics}><FernlyMetricCard label="Reviews recorded" value={report.totalReviews} /><FernlyMetricCard label="Average rating" value={report.totalReviews ? `${report.avgRating} / 5` : '—'} /><FernlyMetricCard label="Goal completion" value={percent(report.goalCompletionRate)} /><FernlyMetricCard label="Projects completed" value={report.completedProjects} /></div><div className={styles.table}><table><thead><tr><th>Department</th><th>Employees</th><th>Rating</th><th>Goal completion</th></tr></thead><tbody>{report.departmentPerformance.map(row => <tr key={row.department}><td>{row.department}</td><td>{row.employees}</td><td>{row.avgRating}</td><td>{row.goalCompletion}%</td></tr>)}</tbody></table></div></details>
      {aiInsights && <section className={styles.card}><h2>AI-assisted insights</h2><p>Suggestions to review, not verified decisions.</p>{['strengths','improvements','recommendations'].map(key => <details className={styles.details} key={key}><summary>{key[0].toUpperCase()+key.slice(1)}</summary><ul>{[aiInsights[key]].flat().filter(Boolean).map((item,index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul></details>)}</section>}
    </>}
  </FernlyMotion>
}
