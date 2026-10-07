'use client'

import { fetchCompleteEmployeeResponse } from '@/lib/client/employeePages'
import { useState, useEffect, useMemo, useRef } from 'react'
import ReportDashboard from '@/components/performance/ReportDashboard'
import toast from '@/utils/toast'
import { downloadExcelWorkbook } from '@/lib/client/spreadsheetExport'
import { useAILoading } from '@/contexts/AILoadingContext'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'

// Helper to format date as YYYY-MM-DD
const formatDateForInput = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

// Get default date range (month to date)
const getDefaultDateRange = () => {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    startDate: formatDateForInput(startOfMonth),
    endDate: formatDateForInput(now)
  }
}

export default function PerformanceReportsPage({ departmentId = 'all' }) {
  const requestVersion = useRef(0)
  const requestAbort = useRef(null)
  const [reportError, setReportError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reportData, setReportData] = useState(null)
  const [attendanceStats, setAttendanceStats] = useState(null)
  const [taskStats, setTaskStats] = useState(null)
  const [dateRange, setDateRange] = useState(getDefaultDateRange())
  const [selectedDepartment, setSelectedDepartment] = useState(departmentId)
  const [selectedTeam, setSelectedTeam] = useState('all')
  const [aiInsights, setAiInsights] = useState(null)
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const [isTeamLeader, setIsTeamLeader] = useState(false)
  const [headedDepartments, setHeadedDepartments] = useState([])
  const [teamLeaderTeams, setTeamLeaderTeams] = useState([])

  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading()

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  // SWR: fetch department head status
  const { data: headCheckRes, isLoading: headCheckLoading, error: headCheckError, mutate: retryHeadCheck } = useAuthedSWR('/api/team/check-head')

  // SWR: fetch departments list
  const { data: deptsRes, error: departmentsError, mutate: retryDepartments } = useAuthedSWR('/api/departments')
  const departments = deptsRes?.data || []

  // SWR: fetch teams for selected department (or team leader's teams)
  const teamsFetchKey = (() => {
    if (isTeamLeader && !isDepartmentHead) return null // Team leaders use teamLeaderTeams directly
    if (selectedDepartment && selectedDepartment !== 'all') return `/api/teams?department=${selectedDepartment}`
    if (headedDepartments.length === 1) return `/api/teams?department=${headedDepartments[0]?._id}`
    return null
  })()
  const { data: teamsRes } = useAuthedSWR(teamsFetchKey)
  const availableTeams = isTeamLeader && !isDepartmentHead
    ? teamLeaderTeams
    : (teamsRes?.data || [])

  // Process head check result
  const headCheckComplete = !headCheckLoading && !!headCheckRes

  useEffect(() => {
    if (headCheckRes?.success) {
      const departmentScoped = headCheckRes.isDepartmentHead && !['admin', 'super_admin', 'hr'].includes(user?.role)
      setIsDepartmentHead(departmentScoped)
      setIsTeamLeader(headCheckRes.isTeamLeader || false)
      const depts = headCheckRes.departments || []
      setHeadedDepartments(depts)
      setTeamLeaderTeams(headCheckRes.teamLeaderTeams || [])
      if (departmentId === 'all' && departmentScoped && depts.length > 0) {
        setSelectedDepartment(depts.length > 1 ? 'all' : depts[0]._id)
      }
    }
  }, [headCheckRes, departmentId, user])

  // Only fetch report data after head check is complete
  useEffect(() => {
    if (user && headCheckComplete) {
      fetchReportData()
    }
    return () => { requestVersion.current += 1; requestAbort.current?.abort() }
  }, [user, headCheckComplete, dateRange.startDate, dateRange.endDate, selectedDepartment, selectedTeam])

  const fetchReportData = async () => {
    const version = ++requestVersion.current
    requestAbort.current?.abort()
    const controller = new AbortController()
    requestAbort.current = controller
    const deadline = setTimeout(() => controller.abort(), 45000)
    try {
      setReportError(null)
      setAiInsights(null)
      setLoading(true)
      const token = localStorage.getItem('token')

      // Build department filter
      let deptFilter = ''
      if (isDepartmentHead && headedDepartments.length > 0) {
        // Department heads can filter their departments
        if (selectedDepartment === 'all') {
          // Show all headed departments
          const deptIds = headedDepartments.map(d => d._id).join(',')
          deptFilter = `&departments=${deptIds}`
        } else {
          // Filter to specific department they head
          deptFilter = `&department=${selectedDepartment}`
        }
      } else if (selectedDepartment !== 'all') {
        // Admins can select any department
        deptFilter = `&department=${selectedDepartment}`
      }

      // Build team filter
      let teamFilterParam = ''
      if (selectedTeam && selectedTeam !== 'all') {
        teamFilterParam = `&team=${selectedTeam}`
      }

      // Fetch all necessary data including company settings, holidays, productivity scores, attendance stats, and task stats
      const [performanceRes, reviewsRes, goalsRes, projectsRes, employeesRes, companyRes, holidaysRes, productivityRes, attendanceStatsRes, taskStatsRes] = await Promise.all([
        fetch(`/api/performance/calculate?populate=true${deptFilter}${teamFilterParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        fetch(`/api/performance/ratings?populate=true${deptFilter}${teamFilterParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        fetch(`/api/performance/goals?populate=true${deptFilter}${teamFilterParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        fetch(`/api/projects?limit=1000&populate=true${deptFilter}${teamFilterParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        fetchCompleteEmployeeResponse(`/api/employees?limit=1000&status=active&populate=true${deptFilter}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        fetch(`/api/settings/company`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        fetch(`/api/holidays?year=${new Date(dateRange.startDate).getFullYear()}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        // Fetch productivity session scores
        fetch(`/api/productivity/scores?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}${deptFilter}${teamFilterParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        // Fetch attendance statistics
        fetch(`/api/performance/attendance-stats?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}${deptFilter}${teamFilterParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        }),
        // Fetch task statistics
        fetch(`/api/performance/task-stats?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}${deptFilter}${teamFilterParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }, signal: controller.signal
        })
      ])

      if (version !== requestVersion.current) return
      const responses = [performanceRes, reviewsRes, goalsRes, projectsRes, employeesRes, companyRes, holidaysRes, productivityRes, attendanceStatsRes, taskStatsRes]
      if (responses.some(response => !response.ok)) throw new Error('Some report sources could not be loaded. Please retry.')
      const performanceData = await performanceRes.json()
      const reviewsData = await reviewsRes.json()
      const goalsData = await goalsRes.json()
      const projectsData = await projectsRes.json()
      const employeesData = await employeesRes.json()
      const companyData = await companyRes.json()
      const holidaysData = await holidaysRes.json()
      const productivityData = await productivityRes.json()
      const attendanceStatsData = await attendanceStatsRes.json()
      const taskStatsData = await taskStatsRes.json()

      if (version !== requestVersion.current) return
      if ([performanceData, reviewsData, goalsData, projectsData, employeesData, companyData, holidaysData, productivityData, attendanceStatsData, taskStatsData].some(result => result.success === false)) throw new Error('A report source returned an error. Please retry.')

      const performanceMetrics = performanceData.success ? performanceData.data : []
      const reviews = reviewsData.success ? reviewsData.data : []
      const goals = goalsData.success ? goalsData.data : []
      const projects = projectsData.success ? projectsData.data : []
      const employees = employeesData.success ? employeesData.data : []
      const companySettings = companyData.success ? companyData.data : null
      const holidays = holidaysData.success ? (holidaysData.data || []) : []
      const productivityScores = productivityData.success ? productivityData.data : []

      // Set new stats data
      if (attendanceStatsData.success && attendanceStatsData.data) {
        setAttendanceStats(attendanceStatsData.data)
      }
      if (taskStatsData.success && taskStatsData.data) {
        setTaskStats(taskStatsData.data)
      }

      // Client-side filter for department heads (extra security layer)
      let filteredEmployees = employees
      let filteredPerformanceMetrics = performanceMetrics
      let filteredReviews = reviews
      let filteredGoals = goals
      let filteredProjects = projects

      if (isDepartmentHead && headedDepartments.length > 0) {
        // Get all department IDs this user heads
        const headedDeptIds = new Set(headedDepartments.map(d => String(d._id)))

        // Filter by selected department or all headed departments
        const deptIdsToFilter = selectedDepartment !== 'all'
          ? new Set([selectedDepartment])
          : headedDeptIds

        filteredEmployees = employees.filter(emp => {
          const empDeptId = String(emp.department?._id || emp.department)
          return deptIdsToFilter.has(empDeptId)
        })
        const employeeIds = new Set(filteredEmployees.map(e => String(e._id)))

        filteredPerformanceMetrics = performanceMetrics.filter(metric =>
          employeeIds.has(String(metric.employee?._id || metric.employee))
        )
        filteredReviews = reviews.filter(review =>
          employeeIds.has(String(review.employee?._id || review.employee))
        )
        filteredGoals = goals.filter(goal =>
          employeeIds.has(String(goal.employee?._id || goal.employee))
        )
        filteredProjects = projects.filter(project => {
          const projDeptId = String(project.department?._id || project.department)
          return deptIdsToFilter.has(projDeptId)
        })
      }

      // Client-side team filter (for when team filter is applied, skip for team leaders as API handles scoping)
      if (selectedTeam && selectedTeam !== 'all' && availableTeams.length > 0 && !isTeamLeader) {
        const team = availableTeams.find(t => t._id === selectedTeam)
        if (team) {
          const teamMemberIds = new Set([
            ...(team.members || []).map(m => String(m._id || m)),
            ...(team.teamLeaders || []).map(l => String(l._id || l))
          ])
          filteredEmployees = filteredEmployees.filter(emp => teamMemberIds.has(String(emp._id)))
          const employeeIds = new Set(filteredEmployees.map(e => String(e._id)))
          filteredPerformanceMetrics = filteredPerformanceMetrics.filter(metric =>
            employeeIds.has(String(metric.employee?._id || metric.employee))
          )
          filteredReviews = filteredReviews.filter(review =>
            employeeIds.has(String(review.employee?._id || review.employee))
          )
          filteredGoals = filteredGoals.filter(goal =>
            employeeIds.has(String(goal.employee?._id || goal.employee))
          )
          filteredProjects = filteredProjects.filter(project => {
            // Filter projects by team member assignment
            const assignedTo = String(project.assignedTo?._id || project.assignedTo)
            return employeeIds.has(assignedTo)
          })
        }
      }

      // Calculate comprehensive KPIs with company settings, holidays, and productivity scores for proper working day calculations
      const kpis = calculateComprehensiveKPIs(filteredPerformanceMetrics, filteredReviews, filteredGoals, filteredProjects, filteredEmployees, companySettings, holidays, productivityScores)
      setReportData(kpis)
    } catch (error) {
      if (version !== requestVersion.current) return
      setReportError(error.message || 'Failed to fetch report data')
      setReportData(null)
    } finally {
      clearTimeout(deadline)
      if (version === requestVersion.current) setLoading(false)
    }
  }

  // Helper function to count working days between two dates
  const countWorkingDays = (startDate, endDate, workingDays, holidays) => {
    const dayNameMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const holidayDates = new Set(holidays.map(h => new Date(h.date).toISOString().split('T')[0]))

    let count = 0
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current <= end) {
      const dayName = dayNameMap[current.getDay()]
      const dateStr = current.toISOString().split('T')[0]

      if (workingDays.includes(dayName) && !holidayDates.has(dateStr)) {
        count++
      }
      current.setDate(current.getDate() + 1)
    }

    return count
  }

  // Helper function to get employee's working days (respects joining date)
  const getEmployeeWorkingDays = (employee, periodStart, periodEnd, workingDays, holidays) => {
    const joiningDate = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null
    const start = new Date(periodStart)
    const end = new Date(periodEnd)

    // If employee hasn't joined yet, return 0
    if (joiningDate && joiningDate > end) {
      return 0
    }

    // Effective start is the later of period start or joining date
    const effectiveStart = joiningDate && joiningDate > start ? joiningDate : start

    return countWorkingDays(effectiveStart, end, workingDays, holidays)
  }

  const calculateComprehensiveKPIs = (performanceMetrics, reviews, goals, projects, employees, companySettings = null, holidays = [], productivityScores = []) => {
    // Get working days from company settings (default to Mon-Fri)
    const workingDays = companySettings?.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

    // Create productivity scores map for quick lookup
    const productivityMap = {}
    productivityScores.forEach(ps => {
      productivityMap[ps.employeeId] = ps
    })

    // Department Performance Analysis
    const deptMap = {}

    employees.forEach(emp => {
      const dept = emp.department?.name || 'Unknown'
      const deptId = emp.department?._id || 'unknown'

      if (!deptMap[deptId]) {
        deptMap[deptId] = {
          name: dept,
          employees: new Set(),
          totalScore: 0,
          totalRating: 0,
          reviewCount: 0,
          goalsCompleted: 0,
          totalGoals: 0,
          projectsCompleted: 0,
          totalProjects: 0,
          skillScores: {},
          productivitySum: 0,
          qualitySum: 0,
          innovationSum: 0,
          // New: Session-based productivity scores
          sessionProductivitySum: 0,
          sessionProductivityCount: 0
        }
      }

      deptMap[deptId].employees.add(emp._id)

      // Add session productivity to department totals
      const empProductivity = productivityMap[emp._id.toString()]
      if (empProductivity?.averageProductivityScore != null) {
        deptMap[deptId].sessionProductivitySum += empProductivity.averageProductivityScore
        deptMap[deptId].sessionProductivityCount++
      }
    })

    // Aggregate performance metrics
    performanceMetrics.forEach(metric => {
      const deptId = metric.employee?.department?._id || metric.employee?.department || 'unknown'
      if (deptMap[deptId]) {
        deptMap[deptId].totalScore += metric.metrics?.performanceScore || 0
        deptMap[deptId].productivitySum += metric.metrics?.productivity || 0
        deptMap[deptId].qualitySum += metric.metrics?.quality || 0
        deptMap[deptId].innovationSum += metric.metrics?.innovation || 0
      }
    })

    // Aggregate reviews
    reviews.forEach(review => {
      const deptId = review.employee?.department?._id || review.employee?.department || 'unknown'
      if (deptMap[deptId]) {
        deptMap[deptId].totalRating += review.rating || 0
        deptMap[deptId].reviewCount += 1
      }
    })

    // Aggregate goals
    goals.forEach(goal => {
      const deptId = goal.employee?.department?._id || goal.employee?.department || 'unknown'
      if (deptMap[deptId]) {
        deptMap[deptId].totalGoals += 1
        if (goal.status === 'completed') {
          deptMap[deptId].goalsCompleted += 1
        }
      }
    })

    // Aggregate projects
    projects.forEach(project => {
      const deptId = project.department?._id || project.department || 'unknown'
      if (deptMap[deptId]) {
        deptMap[deptId].totalProjects += 1
        if (project.status === 'completed') {
          deptMap[deptId].projectsCompleted += 1
        }
      }
    })

    const departmentPerformance = Object.values(deptMap).map(dept => {
      const empCount = dept.employees.size || 1
      return {
        department: dept.name,
        employees: empCount,
        avgScore: (dept.totalScore / empCount).toFixed(1),
        avgRating: dept.reviewCount > 0 ? (dept.totalRating / dept.reviewCount).toFixed(1) : '0',
        goalCompletion: dept.totalGoals > 0 ? ((dept.goalsCompleted / dept.totalGoals) * 100).toFixed(1) : '0',
        projectCompletion: dept.totalProjects > 0 ? ((dept.projectsCompleted / dept.totalProjects) * 100).toFixed(1) : '0',
        productivity: (dept.productivitySum / empCount).toFixed(1),
        quality: (dept.qualitySum / empCount).toFixed(1),
        innovation: (dept.innovationSum / empCount).toFixed(1),
        // New: Session-based productivity (AI-analyzed screenshots)
        sessionProductivity: dept.sessionProductivityCount > 0
          ? Math.round(dept.sessionProductivitySum / dept.sessionProductivityCount)
          : null
      }
    }).sort((a, b) => parseFloat(b.avgScore) - parseFloat(a.avgScore))

    // Employee Performance Metrics
    const employeePerformance = employees.map(emp => {
      const empReviews = reviews.filter(r => String(r.employee?._id || r.employee) === String(emp._id))
      const empGoals = goals.filter(g => String(g.employee?._id || g.employee) === String(emp._id))
      const empMetric = performanceMetrics.find(p => String(p.employee?._id || p.employee) === String(emp._id))
      const empProductivity = productivityMap[emp._id.toString()]

      const completedGoals = empGoals.filter(g => g.status === 'completed').length
      const avgRating = empReviews.length > 0 ?
        (empReviews.reduce((sum, r) => sum + (r.overallRating || 0), 0) / empReviews.length) : 0

      return {
        id: emp._id,
        name: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        department: emp.department?.name || 'Unknown',
        designation: emp.designation?.title || 'N/A',
        avatar: emp.avatar,
        performanceScore: empMetric?.metrics?.performanceScore || 0,
        avgRating: avgRating.toFixed(1),
        reviewCount: empReviews.length,
        goalsCompleted: completedGoals,
        totalGoals: empGoals.length,
        goalCompletion: empGoals.length > 0 ? ((completedGoals / empGoals.length) * 100).toFixed(0) : '0',
        productivity: empMetric?.metrics?.productivity || 0,
        quality: empMetric?.metrics?.quality || 0,
        innovation: empMetric?.metrics?.innovation || 0,
        engagement: empMetric?.metrics?.engagement || 0,
        // New: Session-based productivity (AI-analyzed screenshots)
        sessionProductivity: empProductivity?.averageProductivityScore ?? null,
        sessionFocusScore: empProductivity?.averageFocusScore ?? null,
        sessionCount: empProductivity?.analyzedSessions || 0,
        productivityTrend: empProductivity?.productivityTrend || null
      }
    }).sort((a, b) => b.performanceScore - a.performanceScore)

    // Performance Trends (last 12 months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const trendsMap = {}

    reviews.forEach(review => {
      const date = new Date(review.reviewDate || review.createdAt)
      const monthKey = `${monthNames[date.getMonth()]} ${date.getFullYear()}`
      if (!trendsMap[monthKey]) {
        trendsMap[monthKey] = { totalRating: 0, count: 0, totalScore: 0, scoreCount: 0 }
      }
      trendsMap[monthKey].totalRating += review.overallRating || 0
      trendsMap[monthKey].count += 1
    })

    performanceMetrics.forEach(metric => {
      const date = new Date(metric.createdAt || metric.updatedAt)
      const monthKey = `${monthNames[date.getMonth()]} ${date.getFullYear()}`
      if (trendsMap[monthKey]) {
        trendsMap[monthKey].totalScore += metric.metrics?.performanceScore || 0
        trendsMap[monthKey].scoreCount += 1
      }
    })

    const performanceTrends = Object.keys(trendsMap).slice(-12).map(month => ({
      month,
      avgRating: trendsMap[month].count > 0 ? (trendsMap[month].totalRating / trendsMap[month].count).toFixed(1) : 0,
      avgScore: trendsMap[month].scoreCount > 0 ? (trendsMap[month].totalScore / trendsMap[month].scoreCount).toFixed(1) : 0
    }))

    // Rating Distribution
    const ratingCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    reviews.forEach(review => {
      const rating = Math.round(review.overallRating || 0)
      if (rating >= 1 && rating <= 5) {
        ratingCounts[rating]++
      }
    })

    const totalReviews = reviews.length || 1
    const ratingDistribution = [
      { rating: '5 Stars', count: ratingCounts[5], percentage: Math.round((ratingCounts[5] / totalReviews) * 100) },
      { rating: '4 Stars', count: ratingCounts[4], percentage: Math.round((ratingCounts[4] / totalReviews) * 100) },
      { rating: '3 Stars', count: ratingCounts[3], percentage: Math.round((ratingCounts[3] / totalReviews) * 100) },
      { rating: '2 Stars', count: ratingCounts[2], percentage: Math.round((ratingCounts[2] / totalReviews) * 100) },
      { rating: '1 Star', count: ratingCounts[1], percentage: Math.round((ratingCounts[1] / totalReviews) * 100) }
    ]

    // Goal Completion by Quarter
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4']
    const goalCompletion = quarters.map((quarter, index) => {
      const quarterGoals = goals.filter(g => {
        const date = new Date(g.dueDate || g.createdAt)
        const month = date.getMonth()
        return Math.floor(month / 3) === index
      })
      const completed = quarterGoals.filter(g => g.status === 'completed').length
      const total = quarterGoals.length || 1
      return {
        quarter,
        completed,
        total,
        percentage: Math.round((completed / total) * 100)
      }
    })

    // Skill Analysis
    const skillMap = {}
    reviews.forEach(review => {
      if (review.skills && Array.isArray(review.skills)) {
        review.skills.forEach(skill => {
          if (!skillMap[skill.name]) {
            skillMap[skill.name] = { total: 0, count: 0 }
          }
          skillMap[skill.name].total += skill.rating || 0
          skillMap[skill.name].count += 1
        })
      }
    })

    const skillAnalysis = Object.keys(skillMap).map(skill => ({
      skill,
      avgRating: (skillMap[skill].total / skillMap[skill].count).toFixed(1),
      count: skillMap[skill].count
    })).sort((a, b) => parseFloat(b.avgRating) - parseFloat(a.avgRating)).slice(0, 8)

    // Overall Metrics
    const totalProjects = projects.length
    const completedProjects = projects.filter(p => p.status === 'completed').length
    const avgPerformanceScore = performanceMetrics.length > 0
      ? (performanceMetrics.reduce((sum, p) => sum + (p.metrics?.performanceScore || 0), 0) / performanceMetrics.length).toFixed(1)
      : 0
    const projectCompletionRate = totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0
    const topPerformers = employeePerformance.filter(e => e.performanceScore >= 85).length

    const avgProductivity = employeePerformance.length > 0 ?
      (employeePerformance.reduce((sum, e) => sum + parseFloat(e.productivity), 0) / employeePerformance.length).toFixed(1) : 0
    const avgQuality = employeePerformance.length > 0 ?
      (employeePerformance.reduce((sum, e) => sum + parseFloat(e.quality), 0) / employeePerformance.length).toFixed(1) : 0
    const avgInnovation = employeePerformance.length > 0 ?
      (employeePerformance.reduce((sum, e) => sum + parseFloat(e.innovation), 0) / employeePerformance.length).toFixed(1) : 0
    const avgEngagement = employeePerformance.length > 0 ?
      (employeePerformance.reduce((sum, e) => sum + parseFloat(e.engagement), 0) / employeePerformance.length).toFixed(1) : 0

    // Calculate average session productivity (AI-analyzed)
    const employeesWithSessionData = employeePerformance.filter(e => e.sessionProductivity != null)
    const avgSessionProductivity = employeesWithSessionData.length > 0
      ? Math.round(employeesWithSessionData.reduce((sum, e) => sum + e.sessionProductivity, 0) / employeesWithSessionData.length)
      : null

    return {
      departmentPerformance,
      employeePerformance,
      performanceTrends,
      ratingDistribution,
      goalCompletion,
      skillAnalysis,
      totalReviews: reviews.length,
      totalProjects,
      completedProjects,
      projectCompletionRate,
      avgRating: reviews.length > 0 ? (reviews.reduce((sum, r) => sum + (r.overallRating || 0), 0) / reviews.length).toFixed(1) : 0,
      avgPerformanceScore,
      goalCompletionRate: goals.length > 0 ? Math.round((goals.filter(g => g.status === 'completed').length / goals.length) * 100) : 0,
      topPerformers,
      productivityIndex: avgProductivity,
      qualityScore: avgQuality,
      innovationScore: avgInnovation,
      engagementScore: avgEngagement,
      totalEmployees: employees.length,
      // New: Session-based productivity metrics
      sessionProductivityScore: avgSessionProductivity,
      employeesWithSessionData: employeesWithSessionData.length
    }
  }

  const aiInsightsMutation = useApiMutation({
    method: 'POST',
    onSuccess: (data) => {
      setAiInsights(data.insights)
      toast.success('AI insights generated successfully')
      stopAILoading()
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to generate AI insights')
      stopAILoading()
    }
  })

  const generateAIInsights = () => {
    if (!reportData) {
      toast.error('No report data available')
      return
    }
    startAILoading('MIRA is generating performance insights...')
    aiInsightsMutation.execute('/api/performance/ai-insights', { reportData })
  }

  const exportToExcel = async () => {
    if (!reportData) return

    const sheets = []

    // Overview Sheet
    const overviewData = [
      ['PERFORMANCE REPORT - OVERVIEW'],
      ['Date Range', `${dateRange.startDate} to ${dateRange.endDate}`],
      ['Department', selectedDepartment === 'all' ? 'All Departments' : selectedDepartment],
      [],
      ['KEY METRICS'],
      ['Total Employees', reportData.totalEmployees],
      ['Total Reviews', reportData.totalReviews],
      ['Total Projects', reportData.totalProjects],
      ['Completed Projects', reportData.completedProjects],
      ['Project Completion Rate', reportData.projectCompletionRate + '%'],
      ['Average Performance Score', reportData.avgPerformanceScore],
      ['Average Rating', reportData.avgRating],
      ['Goal Completion Rate', reportData.goalCompletionRate + '%'],
      ['Top Performers (≥85%)', reportData.topPerformers],
      [],
      ['ADVANCED METRICS'],
      ['Productivity Index', reportData.productivityIndex],
      ['Quality Score', reportData.qualityScore],
      ['Innovation Score', reportData.innovationScore],
      ['Engagement Score', reportData.engagementScore],
      ['AI Session Productivity', reportData.sessionProductivityScore != null ? reportData.sessionProductivityScore + '%' : 'N/A'],
      ['Employees with AI Data', reportData.employeesWithSessionData || 0]
    ]
    sheets.push({ name: 'Overview', rows: overviewData })

    // Department Performance
    const deptData = [
      ['DEPARTMENT PERFORMANCE'],
      [],
      ['Department', 'Employees', 'Avg Score', 'Avg Rating', 'Goal Completion %', 'Project Completion %', 'Productivity', 'AI Session Score', 'Quality', 'Innovation'],
      ...reportData.departmentPerformance.map(d => [
        d.department, d.employees, d.avgScore, d.avgRating, d.goalCompletion,
        d.projectCompletion, d.productivity, d.sessionProductivity != null ? d.sessionProductivity + '%' : 'N/A', d.quality, d.innovation
      ])
    ]
    sheets.push({ name: 'Department Performance', rows: deptData })

    // Employee Metrics
    const empData = [
      ['EMPLOYEE PERFORMANCE METRICS'],
      [],
      ['Employee', 'Code', 'Department', 'Designation', 'Performance Score', 'Avg Rating', 'Reviews', 'Goals Completed', 'Total Goals', 'Goal %', 'Productivity', 'AI Session Score', 'Sessions Analyzed', 'Quality', 'Innovation', 'Engagement'],
      ...reportData.employeePerformance.map(e => [
        e.name, e.employeeCode, e.department, e.designation, e.performanceScore,
        e.avgRating, e.reviewCount, e.goalsCompleted, e.totalGoals, e.goalCompletion,
        e.productivity, e.sessionProductivity != null ? e.sessionProductivity + '%' : 'N/A', e.sessionCount || 0, e.quality, e.innovation, e.engagement
      ])
    ]
    sheets.push({ name: 'Employee Metrics', rows: empData })

    // Attendance Stats Sheet
    if (attendanceStats) {
      const attendanceData = [
        ['ATTENDANCE ANALYTICS'],
        [],
        ['Summary'],
        ['Total Employees', attendanceStats.summary?.totalEmployees || 0],
        ['Total Working Days', attendanceStats.summary?.totalWorkingDays || 0],
        ['Present Days', attendanceStats.summary?.presentDays || 0],
        ['Absent Days', attendanceStats.summary?.absentDays || 0],
        ['Half Days', attendanceStats.summary?.halfDays || 0],
        ['Late Arrivals', attendanceStats.summary?.lateArrivals || 0],
        ['Attendance Rate', (attendanceStats.summary?.attendanceRate || 0) + '%'],
        ['Punctuality Rate', (attendanceStats.summary?.punctualityRate || 0) + '%'],
        ['Avg Working Hours', (attendanceStats.summary?.avgWorkingHours || 0) + 'h'],
        ['Utilization Rate', (attendanceStats.summary?.utilizationRate || 0) + '%'],
        [],
        ['Employee Attendance Breakdown'],
        ['Employee', 'Attendance Rate', 'Punctuality', 'Avg Hours', 'Late Arrivals', 'Present Days', 'Absent Days'],
        ...(attendanceStats.employeeBreakdown || []).map(e => [
          e.name, e.attendanceRate + '%', e.punctualityRate + '%', e.avgWorkingHours + 'h',
          e.lateArrivals, e.presentDays, e.absentDays
        ])
      ]
      sheets.push({ name: 'Attendance', rows: attendanceData })
    }

    // Task Stats Sheet
    if (taskStats) {
      const taskData = [
        ['TASK ANALYTICS'],
        [],
        ['Summary'],
        ['Total Tasks', taskStats.summary?.totalTasks || 0],
        ['Completed Tasks', taskStats.summary?.completedTasks || 0],
        ['In Progress', taskStats.summary?.inProgressTasks || 0],
        ['Overdue Tasks', taskStats.summary?.overdueTasks || 0],
        ['Blocked Tasks', taskStats.summary?.blockedTasks || 0],
        ['Task Completion Rate', (taskStats.summary?.taskCompletionRate || 0) + '%'],
        ['On-Time Delivery Rate', (taskStats.summary?.onTimeDeliveryRate || 0) + '%'],
        [],
        ['Employee Task Breakdown'],
        ['Employee', 'Total Tasks', 'Completed', 'Completion Rate', 'On-Time Rate', 'Overdue', 'In Progress'],
        ...(taskStats.employeeBreakdown || []).map(e => [
          e.name, e.totalTasks, e.completedTasks, e.taskCompletionRate + '%',
          e.onTimeDeliveryRate + '%', e.overdueTasks, e.inProgressTasks
        ])
      ]
      sheets.push({ name: 'Tasks', rows: taskData })
    }

    try {
      await downloadExcelWorkbook(`performance-report-${dateRange.startDate}-to-${dateRange.endDate}.xlsx`, sheets)
      toast.success('Excel report exported successfully')
    } catch (error) {
      toast.error(error?.message || 'Could not export the Excel report')
    }
  }

  return <ReportDashboard
    report={reportData} attendance={attendanceStats} tasks={taskStats}
    departmentId={selectedDepartment}
    departments={isDepartmentHead ? headedDepartments : departments}
    teams={availableTeams} team={selectedTeam} setTeam={setSelectedTeam}
    dateRange={dateRange} setDateRange={setDateRange}
    onExport={exportToExcel} onGenerate={generateAIInsights}
    generating={aiInsightsMutation.isLoading} aiInsights={aiInsights}
    loading={!headCheckError && (loading || headCheckLoading)} error={headCheckError ? 'Unable to verify report access. Please retry.' : reportError || (departmentsError ? 'Department filters could not be loaded. Please retry.' : null)}
    onRetry={() => { retryDepartments(); if (headCheckError) retryHeadCheck(); else fetchReportData() }}
  />
}
