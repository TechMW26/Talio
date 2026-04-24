'use client'

import { useState, useEffect, useMemo } from 'react'
import { 
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  Legend, ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis
} from 'recharts'
import {
  FaChartLine, FaUsers, FaTasks, FaCalendarAlt, FaClock,
  FaExclamationTriangle, FaRocket, FaLightbulb, FaCheckCircle,
  FaArrowUp, FaArrowDown, FaBrain, FaStar,
  FaChartPie, FaChartBar, FaTrophy, FaFlag, FaRedo,
  FaTimesCircle, FaQuestionCircle, FaInfoCircle, FaBolt,
  FaUserClock, FaBalanceScale, FaShieldAlt, FaFire, FaBullseye,
  FaUserCheck, FaUserTimes, FaExclamationCircle, FaArrowRight,
  FaHourglassHalf
} from 'react-icons/fa'
import { useTheme } from '@/contexts/ThemeContext'
import { useAILoading } from '@/contexts/AILoadingContext'
import Loader from '@/components/ui/Loader'

// Custom tooltip for charts
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-lg shadow-xl px-4 py-3">
      <p className="text-sm font-semibold text-gray-900 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  )
}

// Status badge colors - high contrast
const statusColors = {
  'ahead': 'bg-green-500 text-white',
  'on-track': 'bg-blue-500 text-white',
  'at-risk': 'bg-amber-500 text-white',
  'delayed': 'bg-red-500 text-white',
  'completed': 'bg-emerald-500 text-white',
  'yet-to-start': 'bg-red-500 text-white',
  'waiting-for-review': 'bg-yellow-400 text-yellow-900'
}

const statusIcons = {
  'ahead': FaRocket,
  'on-track': FaCheckCircle,
  'at-risk': FaExclamationTriangle,
  'delayed': FaTimesCircle,
  'completed': FaTrophy,
  'yet-to-start': FaClock,
  'waiting-for-review': FaHourglassHalf
}

export default function ProjectOverview({ projectId }) {
  const { theme } = useTheme()
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [analytics, setAnalytics] = useState(null)
  const [aiInsights, setAiInsights] = useState(null)
  const [aiInsightsFetched, setAiInsightsFetched] = useState(false) // Track if AI insights were already fetched
  const [error, setError] = useState(null)
  const [activeSection, setActiveSection] = useState('overview')
  
  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading()

  // Theme-aware colors
  const colors = useMemo(() => ({
    primary: theme?.primary?.[500] || '#3B82F6',
    primaryLight: theme?.primary?.[100] || '#DBEAFE',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    info: '#6366F1',
    purple: '#8B5CF6',
    pink: '#EC4899',
    orange: '#F97316',
    teal: '#14B8A6'
  }), [theme])

  // Fetch analytics data
  useEffect(() => {
    fetchAnalytics()
  }, [projectId])

  const fetchAnalytics = async () => {
    try {
      setLoading(true)
      setError(null)
      const token = localStorage.getItem('token')
      
      const response = await fetch(`/api/projects/${projectId}/analytics`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      
      if (data.success) {
        setAnalytics(data.data)
        // AI insights are now fetched on-demand when user clicks Smart Insights tab
      } else {
        setError(data.message || 'Failed to load analytics')
      }
    } catch (err) {
      console.error('Fetch analytics error:', err)
      setError('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  const fetchAIInsights = async (analyticsData) => {
    try {
      setAiLoading(true)
      startAILoading('MIRA is analyzing project insights...')
      const token = localStorage.getItem('token')
      
      const response = await fetch(`/api/projects/${projectId}/analytics`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ analyticsData })
      })

      const data = await response.json()
      
      if (data.success && data.insights) {
        setAiInsights(data.insights)
        setAiInsightsFetched(true)
      }
    } catch (err) {
      console.error('Fetch AI insights error:', err)
    } finally {
      setAiLoading(false)
      stopAILoading()
    }
  }

  const formatDate = (date) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader size="lg" />
          <p className="text-gray-700 font-medium mt-4">Loading project analytics...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <FaExclamationTriangle className="text-4xl text-red-500 mx-auto mb-4" />
        <p className="text-red-600 font-medium">{error}</p>
        <button 
          onClick={fetchAnalytics}
          className="mt-4 px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!analytics) return null

  const { project, memberAnalytics, taskAnalytics, timelineAnalytics, completionPrediction } = analytics
  const StatusIcon = statusIcons[completionPrediction?.status] || FaQuestionCircle

  // Chart data
  const statusChartData = Object.entries(taskAnalytics.statusDistribution).map(([status, count]) => ({
    name: status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value: count,
    color: status === 'completed' ? colors.success 
      : status === 'in-progress' ? colors.primary 
      : status === 'todo' ? '#6B7280'
      : status === 'review' ? colors.purple
      : status === 'blocked' ? colors.danger
      : colors.warning
  }))

  const priorityChartData = Object.entries(taskAnalytics.priorityDistribution).map(([priority, count]) => ({
    name: priority.charAt(0).toUpperCase() + priority.slice(1),
    value: count,
    color: priority === 'critical' ? colors.danger 
      : priority === 'high' ? colors.orange
      : priority === 'medium' ? colors.primary
      : '#6B7280'
  }))

  const memberChartData = memberAnalytics.slice(0, 8).map((m) => ({
    name: `${m.member.firstName} ${m.member.lastName?.[0] || ''}.`,
    completed: m.stats.tasksCompleted,
    inProgress: m.stats.tasksInProgress,
    overdue: m.stats.tasksOverdue,
    productivity: m.stats.productivityScore
  }))

  const progressComparisonData = [
    { name: 'Time Elapsed', value: timelineAnalytics?.timeProgress || 0, fill: colors.warning },
    { name: 'Task Progress', value: timelineAnalytics?.taskProgress || 0, fill: colors.success }
  ]

  return (
    <div className="space-y-6">
      {/* Section Tabs */}
      <div className="flex flex-wrap gap-2 pb-3">
        {[
          { id: 'overview', label: 'Overview', icon: FaChartLine },
          { id: 'team', label: 'Team Analytics', icon: FaUsers },
          { id: 'tasks', label: 'Task Insights', icon: FaTasks },
          { id: 'ai', label: 'Smart Insights', icon: FaBrain }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveSection(tab.id)
              // Fetch AI insights on-demand when Smart Insights tab is clicked
              if (tab.id === 'ai' && !aiInsightsFetched && !aiLoading && analytics) {
                fetchAIInsights(analytics)
              }
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeSection === tab.id
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Section */}
      {activeSection === 'overview' && (
        <div className="space-y-6">
          {/* Project Health Card */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Completion Prediction Card */}
            <div className="lg:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">
                    Project Completion Forecast
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    AI-powered prediction based on current velocity
                  </p>
                </div>
                <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold ${statusColors[completionPrediction?.status] || 'bg-gray-200 text-gray-700'}`}>
                  <StatusIcon className="w-4 h-4" />
                  <span className="capitalize">
                    {completionPrediction?.status === 'waiting-for-review' ? 'Waiting for Review' : completionPrediction?.status?.replace(/-/g, ' ')}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Projected Date</p>
                  <p className="text-lg font-bold text-gray-900">
                    {completionPrediction?.projectedDate 
                      ? formatDate(completionPrediction.projectedDate)
                      : 'Calculating...'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Deadline</p>
                  <p className="text-lg font-bold text-gray-900">
                    {formatDate(project.endDate)}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Variance</p>
                  <p className={`text-lg font-bold flex items-center gap-1 ${
                    (completionPrediction?.daysVariance || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {(completionPrediction?.daysVariance || 0) >= 0 ? <FaArrowUp className="w-3 h-3" /> : <FaArrowDown className="w-3 h-3" />}
                    {Math.abs(completionPrediction?.daysVariance || 0)} days
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Confidence</p>
                  <p className="text-lg font-bold text-gray-900">
                    {completionPrediction?.confidence || 0}%
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100 mt-auto">
                <div className="flex items-center gap-2 mb-2">
                  <FaInfoCircle className="text-blue-600" />
                  <span className="font-bold text-blue-900">Prediction Summary</span>
                </div>
                <p className="text-blue-800 font-medium">
                  {completionPrediction?.message || 'Analyzing project data...'}
                </p>
              </div>
            </div>

            {/* Progress Gauge */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex flex-col">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Progress Overview
              </h3>
              <div className="w-full overflow-hidden" style={{ height: '120px' }}>
                <ResponsiveContainer width="100%" height={240}>
                  <RadialBarChart 
                    cx="50%" 
                    cy="50%" 
                    innerRadius="60%" 
                    outerRadius="90%" 
                    barSize={28}
                    data={[{ 
                      name: 'Progress', 
                      value: project.completionPercentage || 0, 
                      fill: (project.completionPercentage || 0) >= 75 ? '#10B981' : 
                            (project.completionPercentage || 0) >= 50 ? '#3B82F6' : 
                            (project.completionPercentage || 0) >= 25 ? '#F59E0B' : '#EF4444'
                    }]}
                    startAngle={180}
                    endAngle={0}
                  >
                    <PolarAngleAxis 
                      type="number" 
                      domain={[0, 100]} 
                      angleAxisId={0} 
                      tick={false}
                    />
                    <RadialBar 
                      background={{ fill: '#E5E7EB' }}
                      dataKey="value" 
                      cornerRadius={14}
                      angleAxisId={0}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center mt-2">
                <p className={`text-5xl font-black ${
                  (project.completionPercentage || 0) >= 75 ? 'text-green-600' : 
                  (project.completionPercentage || 0) >= 50 ? 'text-blue-600' : 
                  (project.completionPercentage || 0) >= 25 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {project.completionPercentage || 0}%
                </p>
                <p className="text-sm font-semibold text-gray-600">Complete</p>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4 text-center">
                <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                  <p className="text-2xl font-black text-green-600">{taskAnalytics.statusDistribution.completed}</p>
                  <p className="text-xs font-semibold text-green-700">Completed</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                  <p className="text-2xl font-black text-blue-600">{taskAnalytics.total - taskAnalytics.statusDistribution.completed}</p>
                  <p className="text-xs font-semibold text-blue-700">Remaining</p>
                </div>
              </div>
            </div>
          </div>

          {/* Time vs Task Progress */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Time vs Task Progress
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={progressComparisonData} layout="vertical" margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: '#374151', fontWeight: 600 }} />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#374151', fontWeight: 600 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                      {progressComparisonData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex justify-center gap-8 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.warning }} />
                  <span className="font-semibold text-gray-700">Time Elapsed: {timelineAnalytics?.timeProgress || 0}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.success }} />
                  <span className="font-semibold text-gray-700">Tasks Done: {timelineAnalytics?.taskProgress || 0}%</span>
                </div>
              </div>
            </div>

            {/* Burndown Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Task Burndown
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={taskAnalytics.burndownData?.slice(-14) || []} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="burndownGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={colors.primary} stopOpacity={0.4}/>
                        <stop offset="95%" stopColor={colors.primary} stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      tick={{ fill: '#374151', fontWeight: 600, fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: '#374151', fontWeight: 600 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area 
                      type="monotone" 
                      dataKey="remaining" 
                      stroke={colors.primary} 
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#burndownGradient)" 
                      name="Remaining Tasks"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Key Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <FaClock className="text-blue-600 text-xl" />
                <div>
                  <p className="text-xs font-semibold text-gray-900 uppercase">Avg Completion</p>
                  <p className="text-xl font-black text-gray-900">
                    {taskAnalytics.avgCompletionTime || 0} days
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <FaRocket className="text-green-600 text-xl" />
                <div>
                  <p className="text-xs font-semibold text-gray-900 uppercase">Velocity</p>
                  <p className="text-xl font-black text-gray-900">
                    {timelineAnalytics?.velocity || 0}/day
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <FaExclamationTriangle className="text-red-600 text-xl" />
                <div>
                  <p className="text-xs font-semibold text-gray-900 uppercase">Overdue</p>
                  <p className="text-xl font-black text-gray-900">
                    {taskAnalytics.overdueCount || 0} tasks
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3">
                <FaCalendarAlt className="text-amber-600 text-xl" />
                <div>
                  <p className="text-xs font-semibold text-gray-900 uppercase">Due Soon</p>
                  <p className="text-xl font-black text-gray-900">
                    {taskAnalytics.dueSoonCount || 0} tasks
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Analytics Section */}
      {activeSection === 'team' && (
        <div className="space-y-6">
          {/* Member Performance Chart */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Team Task Distribution
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={memberChartData} layout="vertical" margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: '#374151', fontWeight: 600 }} />
                  <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#374151', fontWeight: 600, fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontWeight: 600 }} />
                  <Bar dataKey="completed" name="Completed" fill={colors.success} stackId="a" />
                  <Bar dataKey="inProgress" name="In Progress" fill={colors.primary} stackId="a" />
                  <Bar dataKey="overdue" name="Overdue" fill={colors.danger} stackId="a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Member Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {memberAnalytics.map((member, index) => (
              <div 
                key={member.member._id} 
                className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center text-white text-lg font-bold overflow-hidden">
                    {member.member.profilePicture ? (
                      <img src={member.member.profilePicture} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{member.member.firstName?.[0]}{member.member.lastName?.[0]}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 truncate">
                      {member.member.firstName} {member.member.lastName}
                    </p>
                    <p className="text-sm text-gray-600 truncate">
                      {member.member.email}
                    </p>
                  </div>
                  {index < 3 && (
                    <div className={`p-2 rounded-full ${
                      index === 0 ? 'bg-yellow-400 text-yellow-900' :
                      index === 1 ? 'bg-gray-300 text-gray-700' :
                      'bg-orange-400 text-orange-900'
                    }`}>
                      <FaTrophy className="w-4 h-4" />
                    </div>
                  )}
                </div>

                {/* Productivity Score Bar */}
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="font-semibold text-gray-700">Productivity Score</span>
                    <span className="font-black text-gray-900">{member.stats.productivityScore}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full transition-all ${
                        member.stats.productivityScore >= 80 ? 'bg-green-500' :
                        member.stats.productivityScore >= 60 ? 'bg-blue-500' :
                        member.stats.productivityScore >= 40 ? 'bg-amber-500' :
                        'bg-red-500'
                      }`}
                      style={{ width: `${member.stats.productivityScore}%` }}
                    />
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-green-50 rounded-lg p-2">
                    <p className="text-xl font-black text-green-600">{member.stats.tasksCompleted}</p>
                    <p className="text-xs font-semibold text-green-700">Done</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-2">
                    <p className="text-xl font-black text-blue-600">{member.stats.tasksInProgress}</p>
                    <p className="text-xs font-semibold text-blue-700">Active</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-2">
                    <p className="text-xl font-black text-red-600">{member.stats.tasksOverdue}</p>
                    <p className="text-xs font-semibold text-red-700">Overdue</p>
                  </div>
                </div>

                {/* Completion Rate */}
                <div className="mt-4 pt-4 flex justify-between">
                  <span className="font-semibold text-gray-600">Completion Rate</span>
                  <span className="font-black text-gray-900">{member.stats.completionRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task Insights Section */}
      {activeSection === 'tasks' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Distribution */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Task Status Distribution
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusChartData.filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusChartData.filter(d => d.value > 0).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-4 mt-4">
                {statusChartData.filter(d => d.value > 0).map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: entry.color }} />
                    <span className="text-sm font-semibold text-gray-700">{entry.name}: {entry.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Priority Distribution */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Task Priority Distribution
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={priorityChartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: '#374151', fontWeight: 600 }} />
                    <YAxis tick={{ fill: '#374151', fontWeight: 600 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" name="Tasks" radius={[8, 8, 0, 0]}>
                      {priorityChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Daily Progress */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Daily Task Completion (Last 30 Days)
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={taskAnalytics.dailyProgress || []} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="progressGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={colors.success} stopOpacity={0.4}/>
                      <stop offset="95%" stopColor={colors.success} stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { day: 'numeric' })}
                    tick={{ fill: '#374151', fontWeight: 600, fontSize: 11 }}
                  />
                  <YAxis tick={{ fill: '#374151', fontWeight: 600 }} />
                  <Tooltip 
                    labelFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    content={<ChartTooltip />}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="completed" 
                    stroke={colors.success} 
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#progressGradient)" 
                    name="Tasks Completed"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Subtask Progress */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Subtask Progress
            </h3>
            <div className="flex items-center gap-8">
              <div className="flex-1">
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-semibold text-gray-700">
                    {taskAnalytics.subtaskStats?.completed || 0} of {taskAnalytics.subtaskStats?.total || 0} subtasks
                  </span>
                  <span className="font-black text-gray-900">
                    {taskAnalytics.subtaskStats?.percentage || 0}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-5">
                  <div
                    className="h-5 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                    style={{ width: `${taskAnalytics.subtaskStats?.percentage || 0}%` }}
                  />
                </div>
              </div>
              <div className="text-center bg-blue-50 rounded-xl p-4">
                <p className="text-3xl font-black text-blue-600">{taskAnalytics.subtaskStats?.total || 0}</p>
                <p className="text-sm font-semibold text-blue-700">Total Subtasks</p>
              </div>
            </div>
          </div>

          {/* Estimated Hours */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center gap-4">
                <FaClock className="text-blue-600 text-2xl" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Total Estimated Hours</p>
                  <p className="text-3xl font-black text-gray-900">
                    {taskAnalytics.totalEstimatedHours || 0}h
                  </p>
                  <p className="text-sm font-medium text-gray-500 mt-1">
                    ≈ {Math.ceil((taskAnalytics.totalEstimatedHours || 0) / 8)} working days
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center gap-4">
                <FaCheckCircle className="text-green-600 text-2xl" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Completed Hours</p>
                  <p className="text-3xl font-black text-gray-900">
                    {taskAnalytics.completedEstimatedHours || 0}h
                  </p>
                  <p className="text-sm font-medium text-gray-500 mt-1">
                    {taskAnalytics.totalEstimatedHours > 0 
                      ? Math.round((taskAnalytics.completedEstimatedHours / taskAnalytics.totalEstimatedHours) * 100)
                      : 0}% of estimated work completed
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Smart Insights Section */}
      {activeSection === 'ai' && (
        <div className="space-y-6">
          {aiLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <FaBrain className="animate-pulse text-6xl text-blue-600 mx-auto mb-4" />
                <p className="text-lg font-semibold text-gray-700">Analyzing project data...</p>
                <p className="text-sm text-gray-500 mt-2">Generating actionable insights</p>
              </div>
            </div>
          ) : aiInsights ? (
            <>
              {/* Health Score & Verdict */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {/* Health Score Gauge */}
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                  <div className="text-center">
                    <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full border-4 ${
                      (aiInsights.healthScore || 0) >= 80 ? 'border-green-500 bg-green-50' :
                      (aiInsights.healthScore || 0) >= 60 ? 'border-blue-500 bg-blue-50' :
                      (aiInsights.healthScore || 0) >= 40 ? 'border-amber-500 bg-amber-50' :
                      'border-red-500 bg-red-50'
                    }`}>
                      <span className={`text-2xl font-black ${
                        (aiInsights.healthScore || 0) >= 80 ? 'text-green-600' :
                        (aiInsights.healthScore || 0) >= 60 ? 'text-blue-600' :
                        (aiInsights.healthScore || 0) >= 40 ? 'text-amber-600' :
                        'text-red-600'
                      }`}>{aiInsights.healthScore || 0}</span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-gray-700">Health Score</p>
                    <p className={`text-xs font-semibold uppercase ${
                      aiInsights.healthStatus === 'good' ? 'text-green-600' :
                      aiInsights.healthStatus === 'warning' ? 'text-amber-600' :
                      'text-red-600'
                    }`}>{aiInsights.healthStatus || 'N/A'}</p>
                  </div>
                </div>

                {/* One Line Verdict */}
                <div className="lg:col-span-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center">
                  <FaBrain className="text-blue-600 text-2xl mr-4 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">AI Verdict</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{aiInsights.oneLineVerdict || 'Analysis complete'}</p>
                  </div>
                </div>
              </div>

              {/* Key Metrics Row */}
              {aiInsights.keyMetrics && aiInsights.keyMetrics.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {aiInsights.keyMetrics.slice(0, 4).map((metric, i) => (
                    <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-500 uppercase">{metric.label}</span>
                        {metric.trend === 'up' && <FaArrowUp className="text-green-500 text-xs" />}
                        {metric.trend === 'down' && <FaArrowDown className="text-red-500 text-xs" />}
                      </div>
                      <p className={`text-xl font-black ${
                        metric.status === 'good' ? 'text-green-600' :
                        metric.status === 'warning' ? 'text-amber-600' :
                        metric.status === 'critical' ? 'text-red-600' :
                        'text-gray-900'
                      }`}>{metric.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Immediate Actions */}
              {aiInsights.immediateActions && aiInsights.immediateActions.length > 0 && (
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                  <div className="flex items-center gap-2 mb-4">
                    <FaBolt className="text-amber-500" />
                    <h3 className="font-bold text-gray-900">Immediate Actions</h3>
                    <span className="ml-auto text-xs font-semibold px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                      {aiInsights.immediateActions.length} action{aiInsights.immediateActions.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {aiInsights.immediateActions.map((action, i) => (
                      <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${
                        action.impact === 'high' ? 'bg-red-50 border border-red-100' : 'bg-gray-50'
                      }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          action.impact === 'high' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{action.action}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500">→ {action.owner}</span>
                            <span className="text-xs font-semibold text-amber-600">{action.deadline}</span>
                          </div>
                        </div>
                        <FaArrowRight className="text-gray-400 text-xs" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Two Column: Employee Insights & Quick Wins */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Employee Insights */}
                {aiInsights.employeeInsights && aiInsights.employeeInsights.length > 0 && (
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-2 mb-4">
                      <FaUsers className="text-indigo-500" />
                      <h3 className="font-bold text-gray-900">Team Member Analysis</h3>
                    </div>
                    <div className="space-y-3">
                      {aiInsights.employeeInsights.map((emp, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            emp.status === 'star' ? 'bg-yellow-100' :
                            emp.status === 'ontrack' ? 'bg-green-100' :
                            emp.status === 'attention' ? 'bg-amber-100' :
                            'bg-red-100'
                          }`}>
                            {emp.status === 'star' && <FaStar className="text-yellow-600 text-sm" />}
                            {emp.status === 'ontrack' && <FaUserCheck className="text-green-600 text-sm" />}
                            {emp.status === 'attention' && <FaExclamationCircle className="text-amber-600 text-sm" />}
                            {emp.status === 'overloaded' && <FaUserClock className="text-red-600 text-sm" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 text-sm">{emp.name}</p>
                            <p className="text-xs text-gray-600 mt-0.5">{emp.insight}</p>
                            <p className="text-xs text-blue-600 font-medium mt-1">💡 {emp.suggestion}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick Wins */}
                {aiInsights.quickWins && aiInsights.quickWins.length > 0 && (
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-2 mb-4">
                      <FaRocket className="text-green-500" />
                      <h3 className="font-bold text-gray-900">Quick Wins</h3>
                      <span className="text-xs text-gray-500 ml-1">Low effort, high impact</span>
                    </div>
                    <div className="space-y-2">
                      {aiInsights.quickWins.map((win, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                          <FaCheckCircle className="text-green-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 text-sm">{win.action}</p>
                            <p className="text-xs text-gray-500 mt-0.5">⏱ {win.timeToComplete}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Workload Distribution Chart */}
              {aiInsights.workloadDistribution && (
                <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                  <div className="flex items-center gap-2 mb-4">
                    <FaBalanceScale className="text-blue-500" />
                    <h3 className="font-bold text-gray-900">Workload Distribution</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-red-50 rounded-xl border border-red-100">
                      <FaFire className="text-red-500 text-xl mx-auto mb-2" />
                      <p className="text-xs font-bold text-red-700 uppercase mb-2">Overloaded</p>
                      <div className="space-y-1">
                        {(aiInsights.workloadDistribution.overloaded || []).map((name, i) => (
                          <p key={i} className="text-sm font-semibold text-gray-700">{name}</p>
                        ))}
                        {(!aiInsights.workloadDistribution.overloaded || aiInsights.workloadDistribution.overloaded.length === 0) && (
                          <p className="text-sm text-gray-400">None</p>
                        )}
                      </div>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-xl border border-green-100">
                      <FaCheckCircle className="text-green-500 text-xl mx-auto mb-2" />
                      <p className="text-xs font-bold text-green-700 uppercase mb-2">Balanced</p>
                      <div className="space-y-1">
                        {(aiInsights.workloadDistribution.balanced || []).map((name, i) => (
                          <p key={i} className="text-sm font-semibold text-gray-700">{name}</p>
                        ))}
                        {(!aiInsights.workloadDistribution.balanced || aiInsights.workloadDistribution.balanced.length === 0) && (
                          <p className="text-sm text-gray-400">None</p>
                        )}
                      </div>
                    </div>
                    <div className="text-center p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <FaUserTimes className="text-blue-500 text-xl mx-auto mb-2" />
                      <p className="text-xs font-bold text-blue-700 uppercase mb-2">Underutilized</p>
                      <div className="space-y-1">
                        {(aiInsights.workloadDistribution.underutilized || []).map((name, i) => (
                          <p key={i} className="text-sm font-semibold text-gray-700">{name}</p>
                        ))}
                        {(!aiInsights.workloadDistribution.underutilized || aiInsights.workloadDistribution.underutilized.length === 0) && (
                          <p className="text-sm text-gray-400">None</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Weekly Focus & Risk Radar */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weekly Focus */}
                {aiInsights.weeklyFocus && (
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-2 mb-4">
                      <FaBullseye className="text-purple-500" />
                      <h3 className="font-bold text-gray-900">This Week's Focus</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                        <span className="w-6 h-6 rounded-full bg-purple-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                        <p className="text-sm font-semibold text-gray-900">{aiInsights.weeklyFocus.priority1}</p>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <span className="w-6 h-6 rounded-full bg-gray-400 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                        <p className="text-sm font-medium text-gray-700">{aiInsights.weeklyFocus.priority2}</p>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <span className="w-6 h-6 rounded-full bg-gray-300 text-gray-600 text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                        <p className="text-sm text-gray-600">{aiInsights.weeklyFocus.priority3}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Risk Radar */}
                {aiInsights.riskRadar && aiInsights.riskRadar.length > 0 && (
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-2 mb-4">
                      <FaShieldAlt className="text-red-500" />
                      <h3 className="font-bold text-gray-900">Risk Radar</h3>
                    </div>
                    <div className="space-y-3">
                      {aiInsights.riskRadar.map((risk, i) => (
                        <div key={i} className="p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2 mb-1">
                            <FaExclamationTriangle className={`text-sm ${
                              risk.probability === 'high' ? 'text-red-500' :
                              risk.probability === 'medium' ? 'text-amber-500' :
                              'text-gray-400'
                            }`} />
                            <p className="font-semibold text-gray-900 text-sm">{risk.risk}</p>
                          </div>
                          <div className="flex items-center gap-2 text-xs mb-1">
                            <span className={`px-1.5 py-0.5 rounded font-semibold ${
                              risk.probability === 'high' ? 'bg-red-100 text-red-700' :
                              risk.probability === 'medium' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>P: {risk.probability}</span>
                            <span className={`px-1.5 py-0.5 rounded font-semibold ${
                              risk.impact === 'high' ? 'bg-red-100 text-red-700' :
                              risk.impact === 'medium' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>I: {risk.impact}</span>
                          </div>
                          <p className="text-xs text-blue-600 font-medium">→ {risk.mitigation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Blockers */}
              {aiInsights.blockers && aiInsights.blockers.length > 0 && (
                <div className="bg-white rounded-xl p-5 shadow-sm border border-red-100">
                  <div className="flex items-center gap-2 mb-4">
                    <FaTimesCircle className="text-red-500" />
                    <h3 className="font-bold text-gray-900">Blockers & Bottlenecks</h3>
                    <span className="ml-auto text-xs font-semibold px-2 py-1 bg-red-100 text-red-700 rounded-full">
                      {aiInsights.blockers.length} issue{aiInsights.blockers.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {aiInsights.blockers.map((blocker, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                        <FaExclamationCircle className="text-red-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900 text-sm">{blocker.issue}</p>
                          <p className="text-xs text-gray-600 mt-0.5">Affects {blocker.affectedTasks} task{blocker.affectedTasks > 1 ? 's' : ''}</p>
                          <p className="text-xs text-green-600 font-medium mt-1">✓ Fix: {blocker.suggestedFix}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Projection Insight */}
              {aiInsights.projectionInsight && (
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 border border-blue-100 dark:border-blue-900">
                  <div className="flex items-center gap-3">
                    <FaCalendarAlt className="text-blue-600" />
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{aiInsights.projectionInsight}</p>
                  </div>
                </div>
              )}

              {/* Refresh Button */}
              <div className="flex justify-center">
                <button
                  onClick={() => fetchAIInsights(analytics)}
                  disabled={aiLoading}
                  className="flex items-center gap-2 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
                >
                  <FaRedo className={aiLoading ? 'animate-spin' : ''} />
                  Refresh Insights
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-16 bg-gray-50 rounded-2xl">
              <FaBrain className="text-6xl text-gray-300 mx-auto mb-4" />
              <p className="text-lg font-semibold text-gray-600">Smart insights are not available</p>
              <button
                onClick={() => fetchAIInsights(analytics)}
                className="mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
              >
                Generate Smart Insights
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
