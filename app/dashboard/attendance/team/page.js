'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import { FaUsers, FaBuilding, FaArrowLeft, FaCalendarAlt, FaClock, FaChevronLeft, FaChevronRight, FaSearch, FaUserCircle } from 'react-icons/fa'

export default function TeamAttendancePage() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [view, setView] = useState('initial') // 'initial', 'department', 'employees', 'calendar'
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState(null)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [searchTerm, setSearchTerm] = useState('')
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const [departmentInfo, setDepartmentInfo] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      checkUserRoleAndFetchData(parsedUser)
    }
  }, [])

  const checkUserRoleAndFetchData = async (parsedUser) => {
    try {
      const token = localStorage.getItem('token')
      
      // Check if user is a department head
      const checkHeadResponse = await fetch('/api/team/check-head', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const checkHeadData = await checkHeadResponse.json()
      
      if (checkHeadData.success && checkHeadData.isDepartmentHead) {
        setIsDepartmentHead(true)
        setDepartmentInfo({
          id: checkHeadData.departmentId,
          name: checkHeadData.departmentName
        })
        // Department head - show employees directly
        await fetchDepartmentEmployees(checkHeadData.departmentId)
        setView('employees')
      } else if (['admin', 'hr'].includes(parsedUser.role)) {
        // Admin/HR - show departments first
        await fetchDepartments()
        setView('departments')
      } else {
        toast.error('You do not have permission to view team attendance')
      }
    } catch (error) {
      console.error('Error checking user role:', error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

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
      toast.error('Failed to fetch departments')
    }
  }

  const fetchDepartmentEmployees = async (departmentId) => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees?department=${departmentId}&status=active&limit=500`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
      toast.error('Failed to fetch employees')
    } finally {
      setLoading(false)
    }
  }

  const fetchEmployeeAttendance = async (employeeId, monthDate = currentMonth) => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const month = monthDate.getMonth() + 1
      const year = monthDate.getFullYear()

      const response = await fetch(
        `/api/attendance?employeeId=${employeeId}&month=${month}&year=${year}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
      const data = await response.json()
      if (data.success) {
        setAttendance(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching attendance:', error)
      toast.error('Failed to fetch attendance')
    } finally {
      setLoading(false)
    }
  }

  const handleDepartmentClick = async (department) => {
    setSelectedDepartment(department)
    await fetchDepartmentEmployees(department._id)
    setView('employees')
  }

  const handleEmployeeClick = async (employee) => {
    setSelectedEmployee(employee)
    await fetchEmployeeAttendance(employee._id)
    setView('calendar')
  }

  const handleBack = () => {
    if (view === 'calendar') {
      setView('employees')
      setSelectedEmployee(null)
      setAttendance([])
    } else if (view === 'employees' && !isDepartmentHead) {
      setView('departments')
      setSelectedDepartment(null)
      setEmployees([])
    }
  }

  // Calendar navigation
  const goToPreviousMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    setCurrentMonth(newMonth)
    if (selectedEmployee) {
      fetchEmployeeAttendance(selectedEmployee._id, newMonth)
    }
  }

  const goToNextMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    setCurrentMonth(newMonth)
    if (selectedEmployee) {
      fetchEmployeeAttendance(selectedEmployee._id, newMonth)
    }
  }

  // Helper function to format date as YYYY-MM-DD in local timezone
  const getLocalDateKey = (d) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Calendar data generation
  const calendarData = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay()

    // Get today's date in local format
    const todayKey = getLocalDateKey(new Date())

    const attendanceMap = {}
    attendance.forEach(record => {
      const recordDate = new Date(record.date)
      const dateKey = getLocalDateKey(recordDate)
      attendanceMap[dateKey] = record
    })

    const days = []
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ day: null, date: null, record: null })
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      const dateKey = getLocalDateKey(date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      date.setHours(0, 0, 0, 0)
      days.push({
        day,
        date: dateKey,
        record: attendanceMap[dateKey] || null,
        isToday: dateKey === todayKey,
        isFuture: date > today
      })
    }
    return days
  }, [currentMonth, attendance])

  const getStatusColor = (record, isFuture) => {
    if (isFuture) return 'bg-gray-50'
    if (!record) return 'bg-gray-100'
    switch (record.status) {
      case 'present': return 'bg-green-100 border-green-400'
      case 'in-progress': return 'bg-orange-100 border-orange-400'
      case 'half-day': return 'bg-yellow-100 border-yellow-400'
      case 'late': return 'bg-amber-100 border-amber-400'
      case 'absent': return 'bg-red-100 border-red-400'
      case 'on-leave': return 'bg-blue-100 border-blue-400'
      case 'holiday': return 'bg-purple-100 border-purple-400'
      default: return 'bg-gray-100'
    }
  }

  const getStatusTextColor = (status) => {
    switch (status) {
      case 'present': return 'text-green-700'
      case 'in-progress': return 'text-orange-700'
      case 'half-day': return 'text-yellow-700'
      case 'late': return 'text-amber-700'
      case 'absent': return 'text-red-700'
      case 'on-leave': return 'text-blue-700'
      case 'holiday': return 'text-purple-700'
      default: return 'text-gray-700'
    }
  }

  const formatTime = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const filteredEmployees = employees.filter(emp => {
    const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase()
    const code = (emp.employeeCode || '').toLowerCase()
    return fullName.includes(searchTerm.toLowerCase()) || code.includes(searchTerm.toLowerCase())
  })

  const filteredDepartments = departments.filter(dept => 
    dept.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading && view === 'initial') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center space-x-4 mb-2">
          {(view === 'employees' && !isDepartmentHead) || view === 'calendar' ? (
            <button
              onClick={handleBack}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            >
              <FaArrowLeft className="w-5 h-5" />
            </button>
          ) : null}
          <div>
            <h1 className="text-3xl font-bold text-gray-800">
              {view === 'departments' && 'Team Attendance'}
              {view === 'employees' && (isDepartmentHead ? `${departmentInfo?.name || 'My Team'} Attendance` : `${selectedDepartment?.name || ''} Department`)}
              {view === 'calendar' && `${selectedEmployee?.firstName} ${selectedEmployee?.lastName}`}
            </h1>
            <p className="text-gray-600 mt-1">
              {view === 'departments' && 'Select a department to view employee attendance'}
              {view === 'employees' && 'Select an employee to view their attendance calendar'}
              {view === 'calendar' && 'View attendance calendar and work hours'}
            </p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      {(view === 'departments' || view === 'employees') && (
        <div className="mb-6">
          <div className="relative">
            <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={view === 'departments' ? 'Search departments...' : 'Search employees...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* Departments Grid (Admin View) */}
      {view === 'departments' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDepartments.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-500">
              <FaBuilding className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No departments found</p>
            </div>
          ) : (
            filteredDepartments.map((dept) => (
              <div
                key={dept._id}
                onClick={() => handleDepartmentClick(dept)}
                className="bg-white rounded-xl shadow-md p-6 cursor-pointer hover:shadow-lg transition-all duration-200 border-2 border-transparent hover:border-primary-500"
              >
                <div className="flex items-center space-x-4">
                  <div className="bg-primary-100 p-4 rounded-lg">
                    <FaBuilding className="w-8 h-8 text-primary-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-800">{dept.name}</h3>
                    <p className="text-sm text-gray-500">{dept.description || 'No description'}</p>
                    {dept.head && (
                      <p className="text-xs text-gray-400 mt-1">
                        Head: {dept.head.firstName} {dept.head.lastName}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="bg-gray-100 px-3 py-1 rounded-full">
                      <span className="text-sm font-medium text-gray-600">
                        <FaUsers className="inline mr-1" />
                        {dept.employeeCount || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Employees Grid */}
      {view === 'employees' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredEmployees.length === 0 ? (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <FaUsers className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No employees found</p>
                </div>
              ) : (
                filteredEmployees.map((emp) => (
                  <div
                    key={emp._id}
                    onClick={() => handleEmployeeClick(emp)}
                    className="bg-white rounded-xl shadow-md p-6 cursor-pointer hover:shadow-lg transition-all duration-200 border-2 border-transparent hover:border-primary-500"
                  >
                    <div className="flex flex-col items-center text-center">
                      {emp.avatar ? (
                        <img
                          src={emp.avatar}
                          alt={`${emp.firstName} ${emp.lastName}`}
                          className="w-20 h-20 rounded-full object-cover mb-4"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center mb-4">
                          <span className="text-2xl font-bold text-primary-600">
                            {emp.firstName?.[0]}{emp.lastName?.[0]}
                          </span>
                        </div>
                      )}
                      <h3 className="text-lg font-semibold text-gray-800">
                        {emp.firstName} {emp.lastName}
                      </h3>
                      <p className="text-sm text-gray-500">{emp.designation?.title || 'No Designation'}</p>
                      <p className="text-xs text-gray-400 mt-1">{emp.employeeCode || ''}</p>
                      <div className="mt-3 flex items-center space-x-1 text-primary-600">
                        <FaCalendarAlt className="w-4 h-4" />
                        <span className="text-sm">View Attendance</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Employee Attendance Calendar */}
      {view === 'calendar' && selectedEmployee && (
        <div className="bg-white rounded-lg shadow-md p-6">
          {/* Employee Info Card */}
          <div className="flex items-center space-x-4 mb-6 p-4 bg-gray-50 rounded-lg">
            {selectedEmployee.avatar ? (
              <img
                src={selectedEmployee.avatar}
                alt={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-xl font-bold text-primary-600">
                  {selectedEmployee.firstName?.[0]}{selectedEmployee.lastName?.[0]}
                </span>
              </div>
            )}
            <div>
              <h2 className="text-xl font-semibold text-gray-800">
                {selectedEmployee.firstName} {selectedEmployee.lastName}
              </h2>
              <p className="text-sm text-gray-500">{selectedEmployee.designation?.title || 'No Designation'}</p>
              <p className="text-xs text-gray-400">{selectedEmployee.employeeCode || ''} • {selectedEmployee.email}</p>
            </div>
          </div>

          {/* Month Navigation */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-2">
              <button
                onClick={goToPreviousMonth}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <FaChevronLeft />
              </button>
              <span className="text-lg font-medium text-gray-800 min-w-[160px] text-center">
                {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={goToNextMonth}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <FaChevronRight />
              </button>
            </div>
          </div>

          {/* Status Legend */}
          <div className="flex flex-wrap gap-3 mb-6 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-green-100 border border-green-400"></div>
              <span className="text-xs text-gray-600">Present</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-orange-100 border border-orange-400"></div>
              <span className="text-xs text-gray-600">In Progress</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-yellow-100 border border-yellow-400"></div>
              <span className="text-xs text-gray-600">Half Day</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-amber-100 border border-amber-400"></div>
              <span className="text-xs text-gray-600">Late</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-red-100 border border-red-400"></div>
              <span className="text-xs text-gray-600">Absent</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-blue-100 border border-blue-400"></div>
              <span className="text-xs text-gray-600">On Leave</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-purple-100 border border-purple-400"></div>
              <span className="text-xs text-gray-600">Holiday</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-gray-100 border border-gray-300"></div>
              <span className="text-xs text-gray-600">No Record</span>
            </div>
          </div>

          {/* Calendar Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
            </div>
          ) : (
            <div className="overflow-x-auto overflow-y-visible p-2 -m-2">
              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="text-center text-sm font-semibold text-gray-500 py-2">
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarData.map((dayData, index) => (
                  <div
                    key={index}
                    className={`
                      min-h-[100px] p-2 rounded-lg border-2 transition-all
                      ${dayData.day === null ? 'bg-transparent border-transparent' : 
                        `${getStatusColor(dayData.record, dayData.isFuture)}`
                      }
                      ${dayData.isToday ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                    `}
                  >
                    {dayData.day && (
                      <>
                        <div className="flex justify-between items-start mb-1">
                          <span className={`text-sm font-bold ${dayData.isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                            {dayData.day}
                          </span>
                        </div>
                        
                        {dayData.record ? (
                          <div className="space-y-1">
                            <span className={`text-xs font-medium capitalize ${getStatusTextColor(dayData.record.status)}`}>
                              {dayData.record.status === 'in-progress' ? 'In Progress' : dayData.record.status}
                            </span>
                            <div className="text-[10px] text-gray-500">
                              {dayData.record.checkIn && (
                                <div>In: {formatTime(dayData.record.checkIn)}</div>
                              )}
                              {dayData.record.checkOut && (
                                <div>Out: {formatTime(dayData.record.checkOut)}</div>
                              )}
                              {dayData.record.workHours && (
                                <div className="font-medium">{dayData.record.workHours}h</div>
                              )}
                            </div>
                          </div>
                        ) : !dayData.isFuture ? (
                          <div className="text-xs text-gray-400 mt-1">
                            No record
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Monthly Summary */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Monthly Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {attendance.filter(r => r.status === 'present').length}
                </p>
                <p className="text-sm text-green-700">Present Days</p>
              </div>
              <div className="bg-red-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-red-600">
                  {attendance.filter(r => r.status === 'absent').length}
                </p>
                <p className="text-sm text-red-700">Absent Days</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-amber-600">
                  {attendance.filter(r => r.status === 'late').length}
                </p>
                <p className="text-sm text-amber-700">Late Days</p>
              </div>
              <div className="bg-yellow-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-yellow-600">
                  {attendance.filter(r => r.status === 'half-day').length}
                </p>
                <p className="text-sm text-yellow-700">Half Days</p>
              </div>
            </div>
            
            {/* Total Work Hours */}
            <div className="mt-4 bg-blue-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FaClock className="text-blue-600" />
                  <span className="text-blue-700 font-medium">Total Work Hours</span>
                </div>
                <span className="text-2xl font-bold text-blue-600">
                  {attendance.reduce((sum, r) => sum + (r.workHours || 0), 0).toFixed(1)}h
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
