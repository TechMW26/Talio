'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  FaTasks, FaCheckCircle, FaClock, FaExclamationTriangle, 
  FaPlus, FaFilter, FaChartBar, FaUsers, FaProjectDiagram,
  FaCalendarAlt, FaHourglassHalf, FaArrowUp, FaArrowDown
} from 'react-icons/fa'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts'
import { Select, SelectItem, Button } from '@heroui/react'
import CustomTooltip, { CustomPieTooltip } from '@/components/charts/CustomTooltip'
import Loader from '@/components/ui/Loader'

const TaskDashboard = () => {
  const [dashboardData, setDashboardData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('personal')
  const [timeframe, setTimeframe] = useState('30')
  const [user, setUser] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchDashboardData()
  }, [view, timeframe])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/tasks/dashboard?view=${view}&timeframe=${timeframe}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setDashboardData(data.data)
      } else {
        console.error('Failed to fetch dashboard data')
      }
    } catch (error) {
      console.error('Dashboard fetch error:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    const colors = {
      'completed': 'text-green-600 bg-green-100',
      'in_progress': 'text-blue-600 bg-blue-100',
      'assigned': 'text-yellow-600 bg-yellow-100',
      'overdue': 'text-red-600 bg-red-100',
      'on_hold': 'text-gray-600 bg-gray-100'
    }
    return colors[status] || 'text-gray-600 bg-gray-100'
  }

  const getPriorityColor = (priority) => {
    const colors = {
      'critical': 'text-red-700 bg-red-200',
      'urgent': 'text-red-600 bg-red-100',
      'high': 'text-orange-600 bg-orange-100',
      'medium': 'text-yellow-600 bg-yellow-100',
      'low': 'text-green-600 bg-green-100'
    }
    return colors[priority] || 'text-gray-600 bg-gray-100'
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader size="lg" />
      </div>
    )
  }

  if (!dashboardData) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Failed to load dashboard data</p>
      </div>
    )
  }

  const { overview, charts, recentTasks, upcomingDeadlines, teamPerformance, projectProgress } = dashboardData

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Project Management Dashboard</h1>
          <p className="text-gray-600">Manage and track Projects across your organization</p>
        </div>
        <div className="flex space-x-4">
          {/* View Selector */}
          <Select
            selectedKeys={[view]}
            onChange={(e) => setView(e.target.value)}
            aria-label="View"
            className="w-40"
            classNames={{ trigger: "bg-white" }}
          >
            <SelectItem key="personal">My Tasks</SelectItem>
            {user?.role !== 'employee' && <SelectItem key="team">My Team</SelectItem>}
            {['hr', 'admin'].includes(user?.role) && <SelectItem key="department">Department</SelectItem>}
            {user?.role === 'admin' && <SelectItem key="organization">Organization</SelectItem>}
          </Select>

          {/* Timeframe Selector */}
          <Select
            selectedKeys={[timeframe]}
            onChange={(e) => setTimeframe(e.target.value)}
            aria-label="Timeframe"
            className="w-40"
            classNames={{ trigger: "bg-white" }}
          >
            <SelectItem key="7">Last 7 days</SelectItem>
            <SelectItem key="30">Last 30 days</SelectItem>
            <SelectItem key="90">Last 90 days</SelectItem>
          </Select>

          {/* Create Task Button */}
          <Button
            color="primary"
            onPress={() => router.push('/tasks/create')}
            startContent={<FaPlus className="w-4 h-4" />}
          >
            Create Task
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Tasks</p>
              <p className="text-2xl font-bold text-gray-900">{overview.totalTasks}</p>
            </div>
            <FaTasks className="h-8 w-8 text-blue-600" />
          </div>
          <div className="mt-2">
            <span className="text-sm text-gray-500">
              {overview.completionRate}% completion rate
            </span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Completed</p>
              <p className="text-2xl font-bold text-green-600">{overview.completedTasks}</p>
            </div>
            <FaCheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <div className="mt-2">
            <span className="text-sm text-gray-500">
              {overview.inProgressTasks} in progress
            </span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Overdue</p>
              <p className="text-2xl font-bold text-red-600">{overview.overdueTasks}</p>
            </div>
            <FaExclamationTriangle className="h-8 w-8 text-red-600" />
          </div>
          <div className="mt-2">
            <span className="text-sm text-gray-500">
              {overview.highPriorityTasks} high priority
            </span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Efficiency</p>
              <p className="text-2xl font-bold text-purple-600">{overview.efficiency}%</p>
            </div>
            <FaHourglassHalf className="h-8 w-8 text-purple-600" />
          </div>
          <div className="mt-2">
            <span className="text-sm text-gray-500">
              {overview.totalActualHours}h logged
            </span>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8">
        {/* Tasks by Status */}
        <div style={{ backgroundColor: '#EEF3FF' }} className="rounded-lg overflow-hidden">
          <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
            <h3 className="text-sm sm:text-base font-bold text-gray-800">Tasks by Status</h3>
          </div>
          <div className="h-80 sm:h-80 pr-4 sm:pr-6 pb-4 sm:pb-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.tasksByStatus} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                <XAxis dataKey="_id" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#3B82F6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Tasks by Priority */}
        <div style={{ backgroundColor: '#EEF3FF' }} className="rounded-lg overflow-hidden">
          <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
            <h3 className="text-sm sm:text-base font-bold text-gray-800">Tasks by Priority</h3>
          </div>
          <div className="h-80 sm:h-80 pr-4 sm:pr-6 pb-4 sm:pb-6">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={charts.tasksByPriority}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ _id, percent }) => `${_id} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                  nameKey="_id"
                >
                  {charts.tasksByPriority.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Tasks and Upcoming Deadlines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Tasks */}
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Recent Tasks</h3>
            <button
              onClick={() => router.push('/tasks')}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              View All
            </button>
          </div>
          <div className="space-y-3">
            {recentTasks.slice(0, 5).map((task) => (
              <div key={task._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900 truncate">{task.title}</h4>
                  <p className="text-sm text-gray-500">
                    Assigned by {task.assignedBy?.firstName} {task.assignedBy?.lastName}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
                    {task.status.replace('_', ' ')}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(task.priority)}`}>
                    {task.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Deadlines */}
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Upcoming Deadlines</h3>
            <FaCalendarAlt className="h-5 w-5 text-gray-400" />
          </div>
          <div className="space-y-3">
            {upcomingDeadlines.slice(0, 5).map((task) => (
              <div key={task._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900 truncate">{task.title}</h4>
                  <p className="text-sm text-gray-500">
                    Due: {formatDate(task.dueDate)}
                  </p>
                </div>
                <div className="text-right">
                  <div className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(task.priority)}`}>
                    {task.priority}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {task.progress}% complete
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Team Performance (if applicable) */}
      {teamPerformance.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Performance</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Employee
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tasks
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Completion Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Hours Logged
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Overdue
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {teamPerformance.slice(0, 10).map((member) => (
                  <tr key={member.employeeId}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{member.name}</div>
                        <div className="text-sm text-gray-500">{member.employeeCode}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {member.completedTasks}/{member.totalTasks}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="text-sm font-medium text-gray-900">
                          {member.completionRate.toFixed(1)}%
                        </div>
                        <div className="ml-2 w-16 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${Math.min(100, member.completionRate)}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {member.totalHours}h
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {member.overdueCount > 0 ? (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                          {member.overdueCount}
                        </span>
                      ) : (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                          0
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default TaskDashboard
