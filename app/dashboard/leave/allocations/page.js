'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaPlus, FaEdit, FaUsers, FaCalendarAlt, FaDownload, FaUpload } from 'react-icons/fa'
import ModalPortal from '@/components/ModalPortal'
import Loader from '@/components/ui/Loader'

export default function LeaveAllocationsPage() {
  const [employees, setEmployees] = useState([])
  const [leaveTypes, setLeaveTypes] = useState([])
  const [leaveBalances, setLeaveBalances] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [user, setUser] = useState(null)
  const [bulkMode, setBulkMode] = useState(false)

  const [formData, setFormData] = useState({
    employee: '',
    leaveType: '',
    totalDays: '',
    year: new Date().getFullYear(),
  })

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      
      // Check if user has permission (HR or Admin only)
      if (!['hr', 'admin'].includes(parsedUser.role)) {
        toast.error('Access denied. Only HR and Admin can manage leave allocations.')
        window.location.href = '/dashboard'
        return
      }
      
      fetchData()
    }
  }, [selectedYear])

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token')
      
      // Fetch all data in parallel
      const [employeesRes, leaveTypesRes, balancesRes] = await Promise.all([
        fetch('/api/employees?limit=1000', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/leave/types', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/leave/balance?year=${selectedYear}`, { headers: { 'Authorization': `Bearer ${token}` } })
      ])

      const [employeesData, leaveTypesData, balancesData] = await Promise.all([
        employeesRes.json(),
        leaveTypesRes.json(),
        balancesRes.json()
      ])

      if (employeesData.success) setEmployees(employeesData.data)
      if (leaveTypesData.success) setLeaveTypes(leaveTypesData.data.filter(type => type.isActive))
      if (balancesData.success) setLeaveBalances(balancesData.data)
      
    } catch (error) {
      console.error('Fetch data error:', error)
      toast.error('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave/balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          totalDays: parseInt(formData.totalDays),
          usedDays: 0,
          remainingDays: parseInt(formData.totalDays),
        }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Leave allocation created successfully')
        setShowModal(false)
        resetForm()
        fetchData()
      } else {
        toast.error(data.message || 'Failed to create leave allocation')
      }
    } catch (error) {
      console.error('Submit allocation error:', error)
      toast.error('Failed to create leave allocation')
    } finally {
      setLoading(false)
    }
  }

  const handleBulkAllocation = async () => {
    if (!confirm('This will allocate leave for all employees based on their leave types. Continue?')) {
      return
    }

    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave/balance/bulk-allocate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ year: selectedYear }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Bulk allocation completed for ${data.allocated} employees`)
        fetchData()
      } else {
        toast.error(data.message || 'Failed to perform bulk allocation')
      }
    } catch (error) {
      console.error('Bulk allocation error:', error)
      toast.error('Failed to perform bulk allocation')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      employee: '',
      leaveType: '',
      totalDays: '',
      year: selectedYear,
    })
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const getEmployeeBalance = (employeeId, leaveTypeId) => {
    return leaveBalances.find(balance =>
      balance.employee?._id === employeeId && balance.leaveType?._id === leaveTypeId
    )
  }

  const exportBalances = () => {
    const csvData = []
    csvData.push(['Employee Code', 'Employee Name', 'Leave Type', 'Total Days', 'Used Days', 'Remaining Days'])
    
    leaveBalances.forEach(balance => {
      if (balance.employee && balance.leaveType) {
        csvData.push([
          balance.employee.employeeCode || 'N/A',
          `${balance.employee.firstName || ''} ${balance.employee.lastName || ''}`,
          balance.leaveType.name || 'N/A',
          balance.totalDays || 0,
          balance.usedDays || 0,
          balance.remainingDays || 0
        ])
      }
    })

    const csvContent = csvData.map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leave-balances-${selectedYear}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (loading && leaveBalances.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="lg" />
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Leave Allocations</h1>
          <p className="text-gray-600 mt-1">Manage employee leave balances and allocations</p>
        </div>
       <div className="grid grid-cols-2 md:flex md:space-x-3 md:space-y-0 space-y-2  md:justify-between md:items-center md:flex-row flex-col mb-6 gap-2">
  <select
    value={selectedYear}
    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
    className="px-4 py-2 md:h-[45px] h-[45px] mt-2.5 md:mt-0 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
  >
    {[2024, 2025, 2026, 2027].map(year => (
      <option key={year} value={year}>{year}</option>
    ))}
  </select>

  <button
    onClick={exportBalances}
    className="px-4 py-2 btn-theme-secondary rounded-lg transition-all duration-200 flex items-center space-x-2 font-semibold shadow-md hover:shadow-lg"
  >
    <FaDownload className="w-4 h-4" />
    <span>Export</span>
  </button>

  <button
    onClick={handleBulkAllocation}
    className="px-4 py-2 btn-theme-primary rounded-lg transition-all duration-200 flex items-center space-x-2 font-semibold shadow-md hover:shadow-lg"
  >
    <FaUsers className="w-4 h-4" />
    <span>Bulk Allocate</span>
  </button>

  <button
    onClick={() => {
      resetForm()
      setShowModal(true)
    }}
    className="px-4 py-2 btn-theme-primary rounded-lg transition-all duration-200 flex items-center space-x-2 font-semibold shadow-md hover:shadow-lg"
  >
    <FaPlus className="w-4 h-4" />
    <span>Add Allocation</span>
  </button>
</div>

      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { title: 'Total Employees', value: employees.length, color: 'bg-blue-500', icon: FaUsers },
          { title: 'Leave Types', value: leaveTypes.length, color: 'bg-green-500', icon: FaCalendarAlt },
          { title: 'Total Allocations', value: leaveBalances.length, color: 'bg-purple-500', icon: FaPlus },
          { title: 'Pending Allocations', value: employees.length * leaveTypes.length - leaveBalances.length, color: 'bg-orange-500', icon: FaEdit },
        ].map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">{stat.title}</p>
                <h3 className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</h3>
              </div>
              <div className={`${stat.color} p-4 rounded-lg`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Leave Balances Table */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Employee Leave Balances - {selectedYear}</h2>
        </div>
        
        {employees.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FaUsers className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No employees found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Employee
                  </th>
                  {leaveTypes.map(leaveType => (
                    <th key={leaveType._id} className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {leaveType.name}
                      <br />
                      <span className="text-xs text-gray-400">({leaveType.code})</span>
                    </th>
                  ))}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {employees.map((employee) => (
                  <tr key={employee._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-primary-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                          {employee.firstName?.charAt(0)}{employee.lastName?.charAt(0)}
                        </div>
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">
                            {employee.firstName} {employee.lastName}
                          </div>
                          <div className="text-sm text-gray-500">{employee.employeeCode}</div>
                        </div>
                      </div>
                    </td>
                    {leaveTypes.map(leaveType => {
                      const balance = getEmployeeBalance(employee._id, leaveType._id)
                      return (
                        <td key={leaveType._id} className="px-6 py-4 whitespace-nowrap text-center">
                          {balance ? (
                            <div className="text-sm">
                              <div className="font-medium text-gray-900">
                                {balance.remainingDays}/{balance.totalDays}
                              </div>
                              <div className="text-xs text-gray-500">
                                Used: {balance.usedDays}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">Not allocated</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => {
                          setFormData({
                            employee: employee._id,
                            leaveType: '',
                            totalDays: '',
                            year: selectedYear,
                          })
                          setShowModal(true)
                        }}
                        className="text-primary-600 hover:text-primary-900"
                      >
                        Allocate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <ModalPortal show={showModal}>
        <div className="fixed inset-0 modal-overlay flex items-center justify-center" style={{ zIndex: 99999 }}>
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Add Leave Allocation</h2>
              <button
                onClick={() => {
                  setShowModal(false)
                  resetForm()
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Employee <span className="text-red-500">*</span>
                </label>
                <select
                  name="employee"
                  value={formData.employee}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select Employee</option>
                  {employees.map((employee) => (
                    <option key={employee._id} value={employee._id}>
                      {employee.firstName} {employee.lastName} ({employee.employeeCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Leave Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="leaveType"
                  value={formData.leaveType}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select Leave Type</option>
                  {leaveTypes.map((type) => (
                    <option key={type._id} value={type._id}>
                      {type.name} ({type.code}) - Max: {type.maxDaysPerYear} days
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Total Days <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="totalDays"
                  value={formData.totalDays}
                  onChange={handleChange}
                  required
                  min="1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Enter number of days"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
                <input
                  type="number"
                  name="year"
                  value={formData.year}
                  onChange={handleChange}
                  min="2024"
                  max="2030"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating...' : 'Create Allocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}
