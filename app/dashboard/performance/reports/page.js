'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import * as XLSX from 'xlsx'
import { FaDownload, FaChartBar, FaUsers, FaTrophy, FaCalendarAlt, FaFilter, FaRobot, FaSpinner, FaFileExcel, FaChevronDown, FaChevronUp, FaBrain, FaStar, FaAward, FaTasks, FaBullseye, FaSearch } from 'react-icons/fa'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Area, AreaChart } from 'recharts'
import CustomTooltip from '@/components/charts/CustomTooltip'
import { useAILoading } from '@/contexts/AILoadingContext'

export default function PerformanceReportsPage() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [reportData, setReportData] = useState(null)
  const [selectedPeriod, setSelectedPeriod] = useState('2025')
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [departments, setDepartments] = useState([])
  const [aiInsights, setAiInsights] = useState(null)
  const [generatingInsights, setGeneratingInsights] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    departmentAnalysis: true,
    employeeMetrics: true,
    aiInsights: true
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const [userDepartmentId, setUserDepartmentId] = useState(null)
  
  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading()

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      checkDepartmentHead()
      fetchDepartments()
      fetchReportData()
    }
  }, [])

  const checkDepartmentHead = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/check-head', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setIsDepartmentHead(data.isDepartmentHead)
        setUserDepartmentId(data.departmentId)
        if (data.isDepartmentHead) {
          setSelectedDepartment(data.departmentId)
        }
      }
    } catch (error) {
      console.error('Error checking department head:', error)
    }
  }

  useEffect(() => {
    if (user) {
      fetchReportData()
    }
  }, [selectedPeriod, selectedDepartment])

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching departments:', error)
    }
  }

  const fetchReportData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      // Build department filter - department heads MUST use their department ID
      let deptFilter = ''
      if (isDepartmentHead && userDepartmentId) {
        // Department heads can ONLY see their own department
        deptFilter = `&department=${userDepartmentId}`
      } else if (selectedDepartment !== 'all') {
        // Admins can select any department
        deptFilter = `&department=${selectedDepartment}`
      }

      // Fetch all necessary data including company settings and holidays
      const [performanceRes, reviewsRes, goalsRes, projectsRes, employeesRes, companyRes, holidaysRes] = await Promise.all([
        fetch(`/api/performance/calculate?populate=true${deptFilter}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/performance/ratings?populate=true${deptFilter}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/performance/goals?populate=true${deptFilter}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/projects?limit=1000&populate=true${deptFilter}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/employees?limit=1000&status=active&populate=true${deptFilter}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/settings/company`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/holidays?year=${selectedPeriod}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ])

      const performanceData = await performanceRes.json()
      const reviewsData = await reviewsRes.json()
      const goalsData = await goalsRes.json()
      const projectsData = await projectsRes.json()
      const employeesData = await employeesRes.json()
      const companyData = await companyRes.json()
      const holidaysData = await holidaysRes.json()

      const performanceMetrics = performanceData.success ? performanceData.data : []
      const reviews = reviewsData.success ? reviewsData.data : []
      const goals = goalsData.success ? goalsData.data : []
      const projects = projectsData.success ? projectsData.data : []
      const employees = employeesData.success ? employeesData.data : []
      const companySettings = companyData.success ? companyData.data : null
      const holidays = holidaysData.success ? (holidaysData.data || []) : []

      // Client-side filter for department heads (extra security layer)
      let filteredEmployees = employees
      let filteredPerformanceMetrics = performanceMetrics
      let filteredReviews = reviews
      let filteredGoals = goals
      let filteredProjects = projects

      if (isDepartmentHead && userDepartmentId) {
        filteredEmployees = employees.filter(emp => 
          String(emp.department?._id || emp.department) === String(userDepartmentId)
        )
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
        filteredProjects = projects.filter(project => 
          String(project.department?._id || project.department) === String(userDepartmentId)
        )
      }

      // Calculate comprehensive KPIs with company settings and holidays for proper working day calculations
      const kpis = calculateComprehensiveKPIs(filteredPerformanceMetrics, filteredReviews, filteredGoals, filteredProjects, filteredEmployees, companySettings, holidays)
      setReportData(kpis)
    } catch (error) {
      console.error('Fetch report data error:', error)
      toast.error('Failed to fetch report data')
    } finally {
      setLoading(false)
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

  const calculateComprehensiveKPIs = (performanceMetrics, reviews, goals, projects, employees, companySettings = null, holidays = []) => {
    // Get working days from company settings (default to Mon-Fri)
    const workingDays = companySettings?.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
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
          innovationSum: 0
        }
      }
      
      deptMap[deptId].employees.add(emp._id)
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
        innovation: (dept.innovationSum / empCount).toFixed(1)
      }
    }).sort((a, b) => parseFloat(b.avgScore) - parseFloat(a.avgScore))

    // Employee Performance Metrics
    const employeePerformance = employees.map(emp => {
      const empReviews = reviews.filter(r => String(r.employee?._id || r.employee) === String(emp._id))
      const empGoals = goals.filter(g => String(g.employee?._id || g.employee) === String(emp._id))
      const empMetric = performanceMetrics.find(p => String(p.employee?._id || p.employee) === String(emp._id))
      
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
        engagement: empMetric?.metrics?.engagement || 0
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
      totalEmployees: employees.length
    }
  }

  const generateAIInsights = async () => {
    if (!reportData) {
      toast.error('No report data available')
      return
    }

    setGeneratingInsights(true)
    startAILoading('MIRA is generating performance insights...')
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/ai-insights', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reportData })
      })

      const data = await response.json()
      if (data.success) {
        setAiInsights(data.insights)
        toast.success('AI insights generated successfully')
      } else {
        toast.error(data.message || 'Failed to generate AI insights')
      }
    } catch (error) {
      console.error('AI insights error:', error)
      toast.error('Failed to generate AI insights')
    } finally {
      setGeneratingInsights(false)
      stopAILoading()
    }
  }

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const exportToExcel = () => {
    if (!reportData) return

    const wb = XLSX.utils.book_new()

    // Overview Sheet
    const overviewData = [
      ['PERFORMANCE REPORT - OVERVIEW'],
      ['Year', selectedPeriod],
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
      ['Engagement Score', reportData.engagementScore]
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(overviewData)
    XLSX.utils.book_append_sheet(wb, ws1, 'Overview')

    // Department Performance
    const deptData = [
      ['DEPARTMENT PERFORMANCE'],
      [],
      ['Department', 'Employees', 'Avg Score', 'Avg Rating', 'Goal Completion %', 'Project Completion %', 'Productivity', 'Quality', 'Innovation'],
      ...reportData.departmentPerformance.map(d => [
        d.department, d.employees, d.avgScore, d.avgRating, d.goalCompletion, 
        d.projectCompletion, d.productivity, d.quality, d.innovation
      ])
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(deptData)
    XLSX.utils.book_append_sheet(wb, ws2, 'Department Performance')

    // Employee Metrics
    const empData = [
      ['EMPLOYEE PERFORMANCE METRICS'],
      [],
      ['Employee', 'Code', 'Department', 'Designation', 'Performance Score', 'Avg Rating', 'Reviews', 'Goals Completed', 'Total Goals', 'Goal %', 'Productivity', 'Quality', 'Innovation', 'Engagement'],
      ...reportData.employeePerformance.map(e => [
        e.name, e.employeeCode, e.department, e.designation, e.performanceScore,
        e.avgRating, e.reviewCount, e.goalsCompleted, e.totalGoals, e.goalCompletion,
        e.productivity, e.quality, e.innovation, e.engagement
      ])
    ]
    const ws3 = XLSX.utils.aoa_to_sheet(empData)
    XLSX.utils.book_append_sheet(wb, ws3, 'Employee Metrics')

    XLSX.writeFile(wb, `performance-report-${selectedPeriod}.xlsx`)
    toast.success('Excel report exported successfully')
  }

  const filteredEmployees = reportData?.employeePerformance.filter(emp => {
    const searchLower = searchTerm.toLowerCase()
    return (
      emp.name.toLowerCase().includes(searchLower) ||
      emp.employeeCode.toLowerCase().includes(searchLower) ||
      emp.department.toLowerCase().includes(searchLower)
    )
  }) || []

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  if (!reportData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <FaChartBar className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-600">No performance data available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Performance Reports & Analytics</h1>
            <p className="text-gray-600 mt-1">Comprehensive performance insights with AI-powered analysis</p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={generateAIInsights}
              disabled={generatingInsights}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generatingInsights ? <FaSpinner className="animate-spin" /> : <FaRobot />}
              <span>{generatingInsights ? 'Generating...' : 'AI Insights'}</span>
            </button>
            <button
              onClick={exportToExcel}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <FaFileExcel />
              <span>Export Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              disabled={isDepartmentHead}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {!isDepartmentHead && <option value="all">All Departments</option>}
              {departments
                .filter(dept => !isDepartmentHead || dept._id === userDepartmentId)
                .map(dept => (
                  <option key={dept._id} value={dept._id}>{dept.name}</option>
                ))}
            </select>
            {isDepartmentHead && (
              <p className="text-xs text-gray-500 mt-1">You can only view your department's performance</p>
            )}
          </div>
        </div>
      </div>

      {/* AI Insights Section */}
      {aiInsights && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg shadow-md p-6 mb-6 border border-purple-200">
          <div 
            className="flex items-center justify-between cursor-pointer mb-4"
            onClick={() => toggleSection('aiInsights')}
          >
            <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
              <FaBrain className="text-purple-600" />
              <span>AI-Powered Insights</span>
            </h2>
            {expandedSections.aiInsights ? <FaChevronUp /> : <FaChevronDown />}
          </div>
          
          {expandedSections.aiInsights && (
            <div className="space-y-4">
              <div className="bg-white rounded-lg p-4 border border-purple-100">
                <h3 className="font-semibold text-purple-800 mb-2 flex items-center space-x-2">
                  <FaTrophy className="text-yellow-500" />
                  <span>Key Strengths</span>
                </h3>
                <p className="text-gray-700">{aiInsights.strengths}</p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-purple-100">
                <h3 className="font-semibold text-purple-800 mb-2 flex items-center space-x-2">
                  <FaChartBar className="text-blue-500" />
                  <span>Areas for Improvement</span>
                </h3>
                <p className="text-gray-700">{aiInsights.improvements}</p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-purple-100">
                <h3 className="font-semibold text-purple-800 mb-2 flex items-center space-x-2">
                  <FaBullseye className="text-green-500" />
                  <span>Recommendations</span>
                </h3>
                <p className="text-gray-700">{aiInsights.recommendations}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Overview Metrics */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer mb-4"
          onClick={() => toggleSection('overview')}
        >
          <h2 className="text-xl font-bold text-gray-800">Performance Overview</h2>
          {expandedSections.overview ? <FaChevronUp /> : <FaChevronDown />}
        </div>
        
        {expandedSections.overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaUsers className="text-blue-600" />
                <span className="text-sm text-blue-700 font-medium">Employees</span>
              </div>
              <p className="text-2xl font-bold text-blue-600">{reportData.totalEmployees}</p>
            </div>
            
            <div className="bg-purple-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaStar className="text-purple-600" />
                <span className="text-sm text-purple-700 font-medium">Avg Score</span>
              </div>
              <p className="text-2xl font-bold text-purple-600">{reportData.avgPerformanceScore}</p>
            </div>

            <div className="bg-green-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaTasks className="text-green-600" />
                <span className="text-sm text-green-700 font-medium">Productivity</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{reportData.productivityIndex}</p>
            </div>

            <div className="bg-amber-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaAward className="text-amber-600" />
                <span className="text-sm text-amber-700 font-medium">Quality</span>
              </div>
              <p className="text-2xl font-bold text-amber-600">{reportData.qualityScore}</p>
            </div>

            <div className="bg-indigo-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaTrophy className="text-indigo-600" />
                <span className="text-sm text-indigo-700 font-medium">Innovation</span>
              </div>
              <p className="text-2xl font-bold text-indigo-600">{reportData.innovationScore}</p>
            </div>

            <div className="bg-pink-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaUsers className="text-pink-600" />
                <span className="text-sm text-pink-700 font-medium">Engagement</span>
              </div>
              <p className="text-2xl font-bold text-pink-600">{reportData.engagementScore}</p>
            </div>

            <div className="bg-teal-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaBullseye className="text-teal-600" />
                <span className="text-sm text-teal-700 font-medium">Goal Rate</span>
              </div>
              <p className="text-2xl font-bold text-teal-600">{reportData.goalCompletionRate}%</p>
            </div>

            <div className="bg-cyan-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaChartBar className="text-cyan-600" />
                <span className="text-sm text-cyan-700 font-medium">Project Rate</span>
              </div>
              <p className="text-2xl font-bold text-cyan-600">{reportData.projectCompletionRate}%</p>
            </div>

            <div className="bg-yellow-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaTrophy className="text-yellow-600" />
                <span className="text-sm text-yellow-700 font-medium">Top Performers</span>
              </div>
              <p className="text-2xl font-bold text-yellow-600">{reportData.topPerformers}</p>
            </div>

            <div className="bg-red-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaStar className="text-red-600" />
                <span className="text-sm text-red-700 font-medium">Avg Rating</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{reportData.avgRating}/5</p>
            </div>

            <div className="bg-orange-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaChartBar className="text-orange-600" />
                <span className="text-sm text-orange-700 font-medium">Reviews</span>
              </div>
              <p className="text-2xl font-bold text-orange-600">{reportData.totalReviews}</p>
            </div>

            <div className="bg-lime-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaTasks className="text-lime-600" />
                <span className="text-sm text-lime-700 font-medium">Projects</span>
              </div>
              <p className="text-2xl font-bold text-lime-600">{reportData.totalProjects}</p>
            </div>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Department Performance */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Department Performance Analysis</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reportData.departmentPerformance}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="department" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="avgScore" fill="#3B82F6" name="Avg Score" />
                <Bar dataKey="productivity" fill="#10B981" name="Productivity" />
                <Bar dataKey="quality" fill="#F59E0B" name="Quality" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Performance Trends */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Performance Trends</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={reportData.performanceTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Area type="monotone" dataKey="avgScore" stroke="#8B5CF6" fill="#C4B5FD" name="Avg Score" />
                <Area type="monotone" dataKey="avgRating" stroke="#10B981" fill="#86EFAC" name="Avg Rating" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Rating Distribution */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Rating Distribution</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={reportData.ratingDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ rating, percentage }) => `${rating}: ${percentage}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {reportData.ratingDistribution.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Skill Analysis Radar */}
        {reportData.skillAnalysis.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Top Skills Analysis</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={reportData.skillAnalysis}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="skill" fontSize={10} />
                  <PolarRadiusAxis fontSize={10} />
                  <Radar name="Avg Rating" dataKey="avgRating" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.6} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Department Breakdown Table */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer mb-4"
          onClick={() => toggleSection('departmentAnalysis')}
        >
          <h2 className="text-xl font-bold text-gray-800">Department Analysis</h2>
          {expandedSections.departmentAnalysis ? <FaChevronUp /> : <FaChevronDown />}
        </div>
        
        {expandedSections.departmentAnalysis && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employees</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Rating</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Goal %</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Project %</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Productivity</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quality</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Innovation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {reportData.departmentPerformance.map((dept, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{dept.department}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600">{dept.employees}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-semibold ${parseFloat(dept.avgScore) >= 80 ? 'text-green-600' : parseFloat(dept.avgScore) >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {dept.avgScore}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-amber-600 font-semibold">{dept.avgRating}/5</td>
                    <td className="px-6 py-4 whitespace-nowrap text-blue-600 font-semibold">{dept.goalCompletion}%</td>
                    <td className="px-6 py-4 whitespace-nowrap text-purple-600 font-semibold">{dept.projectCompletion}%</td>
                    <td className="px-6 py-4 whitespace-nowrap text-green-600 font-semibold">{dept.productivity}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-indigo-600 font-semibold">{dept.quality}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-pink-600 font-semibold">{dept.innovation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Employee Performance Table */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div 
          className="flex items-center justify-between cursor-pointer mb-4"
          onClick={() => toggleSection('employeeMetrics')}
        >
          <h2 className="text-xl font-bold text-gray-800">Individual Employee Performance</h2>
          {expandedSections.employeeMetrics ? <FaChevronUp /> : <FaChevronDown />}
        </div>
        
        {expandedSections.employeeMetrics && (
          <>
            <div className="mb-4">
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, code, or department..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rating</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Goals</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Productivity</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quality</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Innovation</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Engagement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-3">
                          {emp.avatar ? (
                            <img src={emp.avatar} alt={emp.name} className="w-8 h-8 rounded-full" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                              <span className="text-xs font-medium text-primary-600">
                                {emp.name.split(' ').map(n => n[0]).join('')}
                              </span>
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900">{emp.name}</p>
                            <p className="text-xs text-gray-500">{emp.designation}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{emp.employeeCode}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{emp.department}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          emp.performanceScore >= 85 ? 'bg-green-100 text-green-800' :
                          emp.performanceScore >= 70 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {emp.performanceScore}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-amber-600 font-semibold">{emp.avgRating}/5</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-semibold">{emp.goalsCompleted}/{emp.totalGoals}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">{emp.productivity}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-600 font-semibold">{emp.quality}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-pink-600 font-semibold">{emp.innovation}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-purple-600 font-semibold">{emp.engagement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
