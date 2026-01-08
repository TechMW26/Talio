'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import * as XLSX from 'xlsx'
import { FaDownload, FaChartBar, FaUsers, FaTrophy, FaCalendarAlt, FaFilter, FaRobot, FaFileExcel, FaChevronDown, FaChevronUp, FaBrain, FaStar, FaAward, FaTasks, FaBullseye, FaSearch, FaClock, FaCheckCircle, FaExclamationTriangle, FaArrowUp, FaArrowDown, FaMinus, FaUserCheck, FaClipboardCheck, FaFire, FaLightbulb, FaExclamationCircle } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Area, AreaChart, ComposedChart } from 'recharts'
import CustomTooltip from '@/components/charts/CustomTooltip'
import { useAILoading } from '@/contexts/AILoadingContext'

// Color palette for charts
const CHART_COLORS = {
  primary: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  purple: '#8B5CF6',
  pink: '#EC4899',
  cyan: '#06B6D4',
  indigo: '#6366F1'
}

// Gauge Chart Component for key metrics
const GaugeChart = ({ value, maxValue = 100, label, color = CHART_COLORS.primary, size = 120 }) => {
  const percentage = Math.min((value / maxValue) * 100, 100)
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference * 0.75 // 270 degrees
  
  // Determine color based on value
  const getColor = () => {
    if (percentage >= 80) return CHART_COLORS.success
    if (percentage >= 60) return CHART_COLORS.warning
    return CHART_COLORS.danger
  }
  
  const gaugeColor = color === 'auto' ? getColor() : color
  
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.75} viewBox={`0 0 ${size} ${size * 0.75}`}>
        {/* Background arc */}
        <path
          d={`M ${strokeWidth / 2} ${size * 0.6} A ${radius} ${radius} 0 1 1 ${size - strokeWidth / 2} ${size * 0.6}`}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Foreground arc */}
        <path
          d={`M ${strokeWidth / 2} ${size * 0.6} A ${radius} ${radius} 0 1 1 ${size - strokeWidth / 2} ${size * 0.6}`}
          fill="none"
          stroke={gaugeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference * 0.75}
          strokeDashoffset={circumference * 0.75 - (percentage / 100) * circumference * 0.75}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        {/* Value text */}
        <text
          x={size / 2}
          y={size * 0.45}
          textAnchor="middle"
          className="text-2xl font-bold"
          fill={gaugeColor}
        >
          {value}%
        </text>
      </svg>
      <span className="text-sm font-medium text-gray-600 mt-1">{label}</span>
    </div>
  )
}

// Trend Indicator Component
const TrendIndicator = ({ current, previous, suffix = '%', higherIsBetter = true }) => {
  if (previous === null || previous === undefined) return null
  
  const diff = current - previous
  const percentChange = previous !== 0 ? ((diff / previous) * 100).toFixed(1) : 0
  
  const isPositive = higherIsBetter ? diff > 0 : diff < 0
  const isNeutral = Math.abs(diff) < 0.5
  
  if (isNeutral) {
    return (
      <span className="flex items-center text-gray-500 text-xs">
        <FaMinus className="mr-1" /> No change
      </span>
    )
  }
  
  return (
    <span className={`flex items-center text-xs ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? <FaArrowUp className="mr-1" /> : <FaArrowDown className="mr-1" />}
      {Math.abs(percentChange)}{suffix} vs prev period
    </span>
  )
}

// Helper to format date as YYYY-MM-DD
const formatDateForInput = (date) => {
  return date.toISOString().split('T')[0]
}

// Get default date range (start of current year to today)
const getDefaultDateRange = () => {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  return {
    startDate: formatDateForInput(startOfYear),
    endDate: formatDateForInput(now)
  }
}

export default function PerformanceReportsPage() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [reportData, setReportData] = useState(null)
  const [attendanceStats, setAttendanceStats] = useState(null)
  const [taskStats, setTaskStats] = useState(null)
  const [dateRange, setDateRange] = useState(getDefaultDateRange())
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [departments, setDepartments] = useState([])
  const [aiInsights, setAiInsights] = useState(null)
  const [generatingInsights, setGeneratingInsights] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    executive: true,
    attendance: true,
    tasks: true,
    productivity: true,
    overview: false,
    departmentAnalysis: true,
    employeeMetrics: true,
    actionableInsights: true,
    aiInsights: false
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
  }, [dateRange.startDate, dateRange.endDate, selectedDepartment])

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

      // Fetch all necessary data including company settings, holidays, productivity scores, attendance stats, and task stats
      const [performanceRes, reviewsRes, goalsRes, projectsRes, employeesRes, companyRes, holidaysRes, productivityRes, attendanceStatsRes, taskStatsRes] = await Promise.all([
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
        fetch(`/api/holidays?year=${new Date(dateRange.startDate).getFullYear()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        // Fetch productivity session scores
        fetch(`/api/productivity/scores?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}${deptFilter ? deptFilter : ''}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        // Fetch attendance statistics
        fetch(`/api/performance/attendance-stats?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}${deptFilter ? deptFilter : ''}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        // Fetch task statistics
        fetch(`/api/performance/task-stats?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}${deptFilter ? deptFilter : ''}`, {
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
      const productivityData = await productivityRes.json()
      const attendanceStatsData = await attendanceStatsRes.json()
      const taskStatsData = await taskStatsRes.json()

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

      // Calculate comprehensive KPIs with company settings, holidays, and productivity scores for proper working day calculations
      const kpis = calculateComprehensiveKPIs(filteredPerformanceMetrics, filteredReviews, filteredGoals, filteredProjects, filteredEmployees, companySettings, holidays, productivityScores)
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
        sessionProductivity: empProductivity?.averageProductivityScore || null,
        sessionFocusScore: empProductivity?.averageFocusScore || null,
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
    const ws1 = XLSX.utils.aoa_to_sheet(overviewData)
    XLSX.utils.book_append_sheet(wb, ws1, 'Overview')

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
    const ws2 = XLSX.utils.aoa_to_sheet(deptData)
    XLSX.utils.book_append_sheet(wb, ws2, 'Department Performance')

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
    const ws3 = XLSX.utils.aoa_to_sheet(empData)
    XLSX.utils.book_append_sheet(wb, ws3, 'Employee Metrics')

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
      const ws4 = XLSX.utils.aoa_to_sheet(attendanceData)
      XLSX.utils.book_append_sheet(wb, ws4, 'Attendance')
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
      const ws5 = XLSX.utils.aoa_to_sheet(taskData)
      XLSX.utils.book_append_sheet(wb, ws5, 'Tasks')
    }

    XLSX.writeFile(wb, `performance-report-${dateRange.startDate}-to-${dateRange.endDate}.xlsx`)
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
        <Loader size="lg" />
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
              {generatingInsights ? <Loader size="xs" /> : <FaRobot />}
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <FaCalendarAlt className="inline mr-2" />
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              max={dateRange.endDate}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <FaCalendarAlt className="inline mr-2" />
              End Date
            </label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              min={dateRange.startDate}
              max={formatDateForInput(new Date())}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
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

      {/* ==================== EXECUTIVE SUMMARY ==================== */}
      <div className="bg-gradient-to-r from-blue-50 via-white to-purple-50 rounded-lg shadow-lg p-6 mb-6 border border-blue-200">
        <div 
          className="flex items-center justify-between cursor-pointer mb-6"
          onClick={() => toggleSection('executive')}
        >
          <h2 className="text-2xl font-bold text-gray-800 flex items-center space-x-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <FaChartBar className="text-white text-xl" />
            </div>
            <span>Executive Summary</span>
          </h2>
          {expandedSections.executive ? <FaChevronUp className="text-gray-500" /> : <FaChevronDown className="text-gray-500" />}
        </div>
        
        {expandedSections.executive && (
          <div className="space-y-6">
            {/* Key Metrics Gauges */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {/* Attendance Rate */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <GaugeChart 
                  value={attendanceStats?.summary?.attendanceRate || 0} 
                  label="Attendance Rate"
                  color="auto"
                />
              </div>
              
              {/* Punctuality Rate */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <GaugeChart 
                  value={attendanceStats?.summary?.punctualityRate || 0} 
                  label="Punctuality"
                  color="auto"
                />
              </div>
              
              {/* Task Completion Rate */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <GaugeChart 
                  value={taskStats?.summary?.taskCompletionRate || 0} 
                  label="Task Completion"
                  color="auto"
                />
              </div>
              
              {/* On-Time Delivery */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <GaugeChart 
                  value={taskStats?.summary?.onTimeDeliveryRate || 0} 
                  label="On-Time Delivery"
                  color="auto"
                />
              </div>
              
              {/* AI Productivity Score */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
                <GaugeChart 
                  value={reportData?.sessionProductivityScore || 0} 
                  label="AI Productivity"
                  color={CHART_COLORS.purple}
                />
              </div>
            </div>

            {/* Quick Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="bg-white rounded-lg p-4 border-l-4 border-blue-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <FaUsers className="text-blue-500 text-2xl" />
                  <span className="text-xs text-gray-500">Total</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 mt-2">{reportData?.totalEmployees || 0}</p>
                <p className="text-sm text-gray-600">Employees</p>
              </div>

              <div className="bg-white rounded-lg p-4 border-l-4 border-green-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <FaCheckCircle className="text-green-500 text-2xl" />
                  <span className="text-xs text-gray-500">Completed</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 mt-2">{taskStats?.summary?.completedTasks || 0}</p>
                <p className="text-sm text-gray-600">Tasks Done</p>
              </div>

              <div className="bg-white rounded-lg p-4 border-l-4 border-red-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <FaExclamationTriangle className="text-red-500 text-2xl" />
                  <span className="text-xs text-gray-500">Attention</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 mt-2">{taskStats?.summary?.overdueTasks || 0}</p>
                <p className="text-sm text-gray-600">Overdue Tasks</p>
              </div>

              <div className="bg-white rounded-lg p-4 border-l-4 border-yellow-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <FaClock className="text-yellow-500 text-2xl" />
                  <span className="text-xs text-gray-500">Average</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 mt-2">{attendanceStats?.summary?.avgWorkingHours?.toFixed(1) || '0.0'}h</p>
                <p className="text-sm text-gray-600">Work Hours/Day</p>
              </div>

              <div className="bg-white rounded-lg p-4 border-l-4 border-purple-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <FaTrophy className="text-purple-500 text-2xl" />
                  <span className="text-xs text-gray-500">Stars</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 mt-2">{reportData?.topPerformers || 0}</p>
                <p className="text-sm text-gray-600">Top Performers</p>
              </div>

              <div className="bg-white rounded-lg p-4 border-l-4 border-indigo-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <FaBullseye className="text-indigo-500 text-2xl" />
                  <span className="text-xs text-gray-500">Goals</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 mt-2">{reportData?.goalCompletionRate || 0}%</p>
                <p className="text-sm text-gray-600">Goal Completion</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== ATTENDANCE ANALYTICS ==================== */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer mb-4"
          onClick={() => toggleSection('attendance')}
        >
          <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
            <FaUserCheck className="text-green-600" />
            <span>Attendance Analytics</span>
          </h2>
          {expandedSections.attendance ? <FaChevronUp /> : <FaChevronDown />}
        </div>
        
        {expandedSections.attendance && attendanceStats && (
          <div className="space-y-6">
            {/* Attendance Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-green-600">{attendanceStats.summary?.attendanceRate || 0}%</p>
                <p className="text-sm text-green-700 font-medium">Attendance Rate</p>
                <p className="text-xs text-gray-500 mt-1">{attendanceStats.summary?.presentDays || 0} present days</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-blue-600">{attendanceStats.summary?.punctualityRate || 0}%</p>
                <p className="text-sm text-blue-700 font-medium">Punctuality Rate</p>
                <p className="text-xs text-gray-500 mt-1">{attendanceStats.summary?.lateArrivals || 0} late arrivals</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-purple-600">{attendanceStats.summary?.avgWorkingHours?.toFixed(1) || '0.0'}h</p>
                <p className="text-sm text-purple-700 font-medium">Avg Working Hours</p>
                <p className="text-xs text-gray-500 mt-1">per day</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-orange-600">{attendanceStats.summary?.utilizationRate || 0}%</p>
                <p className="text-sm text-orange-700 font-medium">Utilization Rate</p>
                <p className="text-xs text-gray-500 mt-1">of expected hours</p>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Attendance by Day of Week - Heat Map Style */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Attendance by Day of Week</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={attendanceStats.dayOfWeekBreakdown || []} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <YAxis dataKey="day" type="category" width={80} />
                      <Tooltip 
                        formatter={(value, name) => [`${value}%`, name === 'attendanceRate' ? 'Attendance' : 'Late Rate']}
                      />
                      <Legend />
                      <Bar dataKey="attendanceRate" fill={CHART_COLORS.success} name="Attendance %" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="lateRate" fill={CHART_COLORS.warning} name="Late %" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Department Attendance Comparison */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Department Attendance</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(attendanceStats.departmentBreakdown || []).map(d => ({
                      ...d,
                      name: departments.find(dept => dept._id === d.departmentId)?.name || 'Unknown'
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" fontSize={10} angle={-45} textAnchor="end" height={60} />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(value) => [`${value}%`]} />
                      <Legend />
                      <Bar dataKey="attendanceRate" fill={CHART_COLORS.success} name="Attendance %" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="punctualityRate" fill={CHART_COLORS.primary} name="Punctuality %" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== TASK ANALYTICS ==================== */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer mb-4"
          onClick={() => toggleSection('tasks')}
        >
          <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
            <FaClipboardCheck className="text-blue-600" />
            <span>Task Analytics</span>
          </h2>
          {expandedSections.tasks ? <FaChevronUp /> : <FaChevronDown />}
        </div>
        
        {expandedSections.tasks && taskStats && (
          <div className="space-y-6">
            {/* Task Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-blue-600">{taskStats.summary?.totalTasks || 0}</p>
                <p className="text-sm text-blue-700 font-medium">Total Tasks</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-green-600">{taskStats.summary?.taskCompletionRate || 0}%</p>
                <p className="text-sm text-green-700 font-medium">Completion Rate</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-purple-600">{taskStats.summary?.onTimeDeliveryRate || 0}%</p>
                <p className="text-sm text-purple-700 font-medium">On-Time Delivery</p>
              </div>
              <div className="bg-yellow-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-yellow-600">{taskStats.summary?.inProgressTasks || 0}</p>
                <p className="text-sm text-yellow-700 font-medium">In Progress</p>
              </div>
              <div className="bg-red-50 rounded-lg p-4 text-center">
                <p className="text-3xl font-bold text-red-600">{taskStats.summary?.overdueTasks || 0}</p>
                <p className="text-sm text-red-700 font-medium">Overdue</p>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Task Status Distribution - Pie */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Task Status Distribution</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={taskStats.statusBreakdown || []}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        dataKey="count"
                        nameKey="status"
                        label={({ status, count }) => `${status}: ${count}`}
                        labelLine={false}
                      >
                        {(taskStats.statusBreakdown || []).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Task by Priority */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Tasks by Priority</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={taskStats.priorityBreakdown || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="priority" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="total" fill={CHART_COLORS.primary} name="Total" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="completed" fill={CHART_COLORS.success} name="Completed" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="overdue" fill={CHART_COLORS.danger} name="Overdue" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Department Task Performance */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-700 mb-4">Dept Task Performance</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(taskStats.departmentBreakdown || []).slice(0, 5)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <YAxis dataKey="name" type="category" width={100} fontSize={10} />
                      <Tooltip formatter={(value) => [`${value}%`]} />
                      <Bar dataKey="taskCompletionRate" fill={CHART_COLORS.success} name="Completion %" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== ACTIONABLE INSIGHTS ==================== */}
      <div className="bg-gradient-to-r from-orange-50 via-white to-red-50 rounded-lg shadow-md p-6 mb-6 border border-orange-200">
        <div 
          className="flex items-center justify-between cursor-pointer mb-4"
          onClick={() => toggleSection('actionableInsights')}
        >
          <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
            <FaLightbulb className="text-orange-500" />
            <span>Actionable Insights</span>
          </h2>
          {expandedSections.actionableInsights ? <FaChevronUp /> : <FaChevronDown />}
        </div>
        
        {expandedSections.actionableInsights && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top Performers */}
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <h3 className="text-lg font-semibold text-green-700 mb-4 flex items-center">
                <FaTrophy className="mr-2 text-yellow-500" />
                Top Performers (Attendance)
              </h3>
              <div className="space-y-3">
                {(attendanceStats?.employeeBreakdown || [])
                  .sort((a, b) => b.attendanceRate - a.attendanceRate)
                  .slice(0, 5)
                  .map((emp, idx) => (
                    <div key={emp.employeeId} className="flex items-center justify-between p-2 bg-green-50 rounded">
                      <div className="flex items-center space-x-2">
                        <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        <span className="font-medium text-gray-700">{emp.name}</span>
                      </div>
                      <span className="text-green-600 font-bold">{emp.attendanceRate}%</span>
                    </div>
                  ))}
                {(attendanceStats?.employeeBreakdown || []).length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-4">No attendance data available</p>
                )}
              </div>
            </div>

            {/* Needs Attention */}
            <div className="bg-white rounded-lg p-4 border border-red-200">
              <h3 className="text-lg font-semibold text-red-700 mb-4 flex items-center">
                <FaExclamationCircle className="mr-2 text-red-500" />
                Needs Attention
              </h3>
              <div className="space-y-3">
                {(taskStats?.employeeBreakdown || [])
                  .filter(e => e.overdueTasks > 0)
                  .sort((a, b) => b.overdueTasks - a.overdueTasks)
                  .slice(0, 5)
                  .map((emp, idx) => (
                    <div key={emp.employeeId} className="flex items-center justify-between p-2 bg-red-50 rounded">
                      <span className="font-medium text-gray-700">{emp.name}</span>
                      <div className="text-right">
                        <span className="text-red-600 font-bold">{emp.overdueTasks}</span>
                        <span className="text-xs text-gray-500 ml-1">overdue</span>
                      </div>
                    </div>
                  ))}
                {(taskStats?.employeeBreakdown || []).filter(e => e.overdueTasks > 0).length === 0 && (
                  <p className="text-green-600 text-sm text-center py-4">✓ No employees with overdue tasks</p>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-lg p-4 border border-blue-200">
              <h3 className="text-lg font-semibold text-blue-700 mb-4 flex items-center">
                <FaFire className="mr-2 text-orange-500" />
                Key Metrics Summary
              </h3>
              <div className="space-y-3">
                <div className="p-3 bg-gray-50 rounded">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Late Arrivals</span>
                    <span className={`font-bold ${(attendanceStats?.summary?.lateArrivals || 0) > 10 ? 'text-red-600' : 'text-green-600'}`}>
                      {attendanceStats?.summary?.lateArrivals || 0}
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Blocked Tasks</span>
                    <span className={`font-bold ${(taskStats?.summary?.blockedTasks || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {taskStats?.summary?.blockedTasks || 0}
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Employees Analyzed</span>
                    <span className="font-bold text-purple-600">
                      {reportData?.employeesWithSessionData || 0}
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Absent Days</span>
                    <span className={`font-bold ${(attendanceStats?.summary?.absentDays || 0) > 5 ? 'text-red-600' : 'text-yellow-600'}`}>
                      {attendanceStats?.summary?.absentDays || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
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

            {/* Session Productivity - AI Analyzed */}
            <div className="bg-violet-50 rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <FaBrain className="text-violet-600" />
                <span className="text-sm text-violet-700 font-medium">AI Productivity</span>
              </div>
              <p className="text-2xl font-bold text-violet-600">
                {reportData.sessionProductivityScore != null ? `${reportData.sessionProductivityScore}%` : 'N/A'}
              </p>
              {reportData.employeesWithSessionData > 0 && (
                <p className="text-xs text-violet-500 mt-1">
                  {reportData.employeesWithSessionData} employees analyzed
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Department Performance - Using Real Data */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Department Performance Comparison</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={(attendanceStats?.departmentBreakdown || []).map(dept => {
                  const taskDept = (taskStats?.departmentBreakdown || []).find(t => t.departmentId === dept.departmentId)
                  const deptName = departments.find(d => d._id === dept.departmentId)?.name || 'Unknown'
                  return {
                    department: deptName,
                    attendance: dept.attendanceRate || 0,
                    punctuality: dept.punctualityRate || 0,
                    taskCompletion: taskDept?.taskCompletionRate || 0
                  }
                })}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="department" fontSize={10} angle={-20} textAnchor="end" height={50} />
                <YAxis fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(value) => [`${value}%`]} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="attendance" fill={CHART_COLORS.success} name="Attendance %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="punctuality" fill={CHART_COLORS.primary} name="Punctuality %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="taskCompletion" fill={CHART_COLORS.purple} name="Task Completion %" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* AI Productivity by Employee */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">AI Productivity Scores (Top 10)</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={(reportData?.employeePerformance || [])
                  .filter(e => e.sessionProductivity != null)
                  .slice(0, 10)
                  .map(e => ({
                    name: e.name?.split(' ')[0] || 'N/A',
                    aiScore: e.sessionProductivity || 0,
                    focusScore: e.sessionFocusScore || 0
                  }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis dataKey="name" type="category" width={80} fontSize={10} />
                <Tooltip formatter={(value) => [`${value}%`]} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="aiScore" fill={CHART_COLORS.purple} name="AI Score" radius={[0, 4, 4, 0]} />
                <Bar dataKey="focusScore" fill={CHART_COLORS.cyan} name="Focus Score" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Rating Distribution - Full Width */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Rating Distribution</h3>
        {reportData.ratingDistribution && reportData.ratingDistribution.some(r => r.count > 0) ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={reportData.ratingDistribution.filter(r => r.count > 0)}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={({ rating, percentage, count }) => `${rating}: ${count} (${percentage}%)`}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {reportData.ratingDistribution.filter(r => r.count > 0).map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-80 flex flex-col items-center justify-center text-gray-400">
            <FaStar className="text-6xl mb-4 text-gray-300" />
            <p className="text-lg font-medium">No Ratings Yet</p>
            <p className="text-sm">Performance ratings will appear here once reviews are submitted</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">AI Score</th>
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      {dept.sessionProductivity != null ? (
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          dept.sessionProductivity >= 70 ? 'bg-green-100 text-green-800' :
                          dept.sessionProductivity >= 40 ? 'bg-amber-100 text-amber-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {dept.sessionProductivity}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">N/A</span>
                      )}
                    </td>
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">AI Score</th>
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        {emp.sessionProductivity != null ? (
                          <div className="flex items-center gap-1">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              emp.sessionProductivity >= 70 ? 'bg-green-100 text-green-800' :
                              emp.sessionProductivity >= 40 ? 'bg-amber-100 text-amber-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {emp.sessionProductivity}%
                            </span>
                            {emp.productivityTrend != null && emp.productivityTrend !== 0 && (
                              <span className={`text-xs ${emp.productivityTrend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {emp.productivityTrend > 0 ? '↑' : '↓'}{Math.abs(emp.productivityTrend)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">No data</span>
                        )}
                      </td>
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
