'use client'

import { useState, useEffect, useMemo } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import toast from '@/utils/toast'
import { FaUsers, FaBuilding, FaArrowLeft, FaCalendarAlt, FaClock, FaChevronLeft, FaChevronRight, FaSearch, FaUserCircle, FaMapMarkerAlt, FaFilter, FaUserFriends } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Skeleton, Input, Select, SelectItem } from '@heroui/react'

// Department color palette
const DEPARTMENT_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-700', badge: 'bg-blue-500' },
  { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-700', badge: 'bg-purple-500' },
  { bg: 'bg-emerald-100', border: 'border-emerald-400', text: 'text-emerald-700', badge: 'bg-emerald-500' },
  { bg: 'bg-amber-100', border: 'border-amber-400', text: 'text-amber-700', badge: 'bg-amber-500' },
  { bg: 'bg-rose-100', border: 'border-rose-400', text: 'text-rose-700', badge: 'bg-rose-500' },
  { bg: 'bg-cyan-100', border: 'border-cyan-400', text: 'text-cyan-700', badge: 'bg-cyan-500' },
  { bg: 'bg-indigo-100', border: 'border-indigo-400', text: 'text-indigo-700', badge: 'bg-indigo-500' },
  { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-700', badge: 'bg-teal-500' },
  { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-700', badge: 'bg-orange-500' },
  { bg: 'bg-pink-100', border: 'border-pink-400', text: 'text-pink-700', badge: 'bg-pink-500' },
]

export default function TeamAttendancePage() {
  const [view, setView] = useState('initial') // 'initial', 'employees', 'calendar'
  const [employees, setEmployees] = useState([])
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState('all')
  const [selectedTeamFilter, setSelectedTeamFilter] = useState('all')
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [searchTerm, setSearchTerm] = useState('')
  const [departmentColorMap, setDepartmentColorMap] = useState({})
  const [employeesLoading, setEmployeesLoading] = useState(true)

  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])
  const isAdmin = user && ['admin', 'hr'].includes(user.role)

  // SWR: Check if user is a department head
  const { data: headCheckRes, isLoading: headCheckLoading, error: headCheckError } = useAuthedSWR(
    user ? '/api/team/check-head' : null
  )
  const isDepartmentHead = headCheckRes?.success && headCheckRes?.isDepartmentHead
  const headedDepartments = headCheckRes?.departments || []
  const departmentInfo = useMemo(() => {
    if (!isDepartmentHead || headedDepartments.length === 0) return null
    return {
      id: headedDepartments[0]._id,
      name: headedDepartments.length > 1 ? 'Multiple Departments' : headedDepartments[0].name
    }
  }, [isDepartmentHead, headedDepartments])

  // SWR: Departments list (admin filter dropdown)
  const { data: deptsRes } = useAuthedSWR(isAdmin ? '/api/departments' : null)
  const departments = deptsRes?.data || []

  // SWR: Fetch teams for selected department
  const teamsFetchKey = (() => {
    if (selectedDepartmentFilter && selectedDepartmentFilter !== 'all') return `/api/teams?department=${selectedDepartmentFilter}`
    if (!isAdmin && headedDepartments.length === 1) return `/api/teams?department=${headedDepartments[0]?._id}`
    return null
  })()
  const { data: teamsRes } = useAuthedSWR(teamsFetchKey)
  const availableTeams = teamsRes?.data || []

  // Fetch employees when head-check resolves (dependent effect - branching fetch logic)
  useEffect(() => {
    if (!headCheckRes) return

    const fetchEmployees = async () => {
      setEmployeesLoading(true)
      const token = localStorage.getItem('token')
      const headers = { 'Authorization': `Bearer ${token}` }

      try {
        if (isAdmin) {
          const response = await fetch('/api/employees?status=active&limit=1000', { headers })
          const data = await response.json()
          if (data.success) {
            const allEmployees = data.data || []
            setEmployees(allEmployees)
            buildDepartmentColorMap(allEmployees)
          }
        } else if (isDepartmentHead && headedDepartments.length > 0) {
          const allEmployees = []
          for (const dept of headedDepartments) {
            const response = await fetch(`/api/employees?department=${dept._id}&status=active&limit=500`, { headers })
            const data = await response.json()
            if (data.success) allEmployees.push(...(data.data || []))
          }
          const uniqueEmployees = allEmployees.filter((emp, i, self) => i === self.findIndex(e => e._id === emp._id))
          setEmployees(uniqueEmployees)
          buildDepartmentColorMap(uniqueEmployees)
        } else {
          toast.error('You do not have permission to view team attendance')
        }
      } catch (error) {
        console.error('Error fetching employees:', error)
        toast.error('Failed to fetch employees')
      } finally {
        setEmployeesLoading(false)
        setView('employees')
      }
    }

    fetchEmployees()
  }, [headCheckRes, isAdmin, isDepartmentHead, headedDepartments])

  const buildDepartmentColorMap = (employeeList) => {
    const uniqueDepts = [...new Set(employeeList.map(e => e.department?._id || e.department).filter(Boolean))]
    const colorMap = {}
    uniqueDepts.forEach((deptId, index) => {
      colorMap[deptId] = DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length]
    })
    setDepartmentColorMap(colorMap)
  }

  // SWR: Employee attendance for calendar view (auto-refetches on month change)
  const attendanceKey = useMemo(() => {
    if (!selectedEmployee) return null
    const month = currentMonth.getMonth() + 1
    const year = currentMonth.getFullYear()
    return `/api/attendance?employeeId=${selectedEmployee._id}&month=${month}&year=${year}`
  }, [selectedEmployee, currentMonth])

  const { data: attendanceRes, isLoading: attLoading, isValidating: attValidating } = useAuthedSWR(
    attendanceKey, { keepPreviousData: false }
  )
  const attendance = attendanceRes?.data || []

  const handleEmployeeClick = (employee) => {
    setSelectedEmployee(employee)
    setCurrentMonth(new Date())
    setView('calendar')
  }

  const handleBack = () => {
    if (view === 'calendar') {
      setView('employees')
      setSelectedEmployee(null)
    }
  }

  // Calendar navigation - just update state, SWR auto-refetches
  const goToPreviousMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
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
    if (isFuture) return 'bg-default-50'
    if (!record) return 'bg-default-100'
    switch (record.status) {
      case 'present': return 'bg-success-100 border-success'
      case 'in-progress': return 'bg-warning-100 border-warning'
      case 'half-day': return 'bg-warning-100 border-warning'
      case 'late': return 'bg-warning-100 border-warning'
      case 'absent': return 'bg-danger-100 border-danger'
      case 'on-leave': return 'bg-primary-100 border-primary'
      case 'holiday': return 'bg-secondary-100 border-secondary'
      default: return 'bg-default-100'
    }
  }

  const getStatusTextColor = (status) => {
    switch (status) {
      case 'present': return 'text-success-700'
      case 'in-progress': return 'text-warning-700'
      case 'half-day': return 'text-warning-700'
      case 'late': return 'text-warning-700'
      case 'absent': return 'text-danger-700'
      case 'on-leave': return 'text-primary-700'
      case 'holiday': return 'text-secondary-700'
      default: return 'text-default-700'
    }
  }

  const formatTime = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const filteredEmployees = useMemo(() => {
    let result = employees.filter(emp => {
      const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase()
      const code = (emp.employeeCode || '').toLowerCase()
      const matchesSearch = fullName.includes(searchTerm.toLowerCase()) || code.includes(searchTerm.toLowerCase())

      // Apply department filter
      if (selectedDepartmentFilter !== 'all') {
        const empDeptId = emp.department?._id || emp.department
        if (empDeptId?.toString() !== selectedDepartmentFilter) return false
      }

      // Apply team filter
      if (selectedTeamFilter !== 'all' && availableTeams.length > 0) {
        const team = availableTeams.find(t => t._id === selectedTeamFilter)
        if (team) {
          const teamMemberIds = new Set([
            ...(team.members || []).map(m => (m._id || m).toString()),
            ...(team.teamLeaders || []).map(l => (l._id || l).toString())
          ])
          if (!teamMemberIds.has(emp._id?.toString())) return false
        }
      }

      return matchesSearch
    })

    // For admin who is also a dept head, sort their dept employees first
    if (isAdmin && isDepartmentHead && headedDepartments.length > 0) {
      const headedDeptIds = headedDepartments.map(d => d._id?.toString())
      result.sort((a, b) => {
        const aDeptId = (a.department?._id || a.department)?.toString()
        const bDeptId = (b.department?._id || b.department)?.toString()
        const aInHeaded = headedDeptIds.includes(aDeptId)
        const bInHeaded = headedDeptIds.includes(bDeptId)

        if (aInHeaded && !bInHeaded) return -1
        if (!aInHeaded && bInHeaded) return 1

        // Secondary sort by department name for grouping
        const aDeptName = a.department?.name || ''
        const bDeptName = b.department?.name || ''
        return aDeptName.localeCompare(bDeptName)
      })
    } else {
      // Sort by department name for grouping
      result.sort((a, b) => {
        const aDeptName = a.department?.name || ''
        const bDeptName = b.department?.name || ''
        return aDeptName.localeCompare(bDeptName)
      })
    }

    return result
  }, [employees, searchTerm, selectedDepartmentFilter, selectedTeamFilter, availableTeams, isAdmin, isDepartmentHead, headedDepartments])

  // Get unique departments from employees for filter dropdown
  const availableDepartments = useMemo(() => {
    const depts = new Map()
    employees.forEach(emp => {
      const deptId = emp.department?._id || emp.department
      const deptName = emp.department?.name
      if (deptId && deptName) {
        depts.set(deptId.toString(), { _id: deptId, name: deptName })
      }
    })
    return Array.from(depts.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [employees])

  if (headCheckError) return <DataErrorState message="Failed to check team permissions" onRetry={() => window.location.reload()} />

  if ((headCheckLoading || employeesLoading) && view === 'initial') {
    return (
      <div className="page-container space-y-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-4 w-96 rounded-lg" />
        </div>
        <Skeleton className="h-12 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center space-x-4 mb-2">
          {view === 'calendar' ? (
            <Button
              isIconOnly
              variant="flat"
              onPress={handleBack}
            >
              <FaArrowLeft className="w-5 h-5" />
            </Button>
          ) : null}
          <div>
            <h1 className="text-3xl font-bold text-default-800">
              {view === 'employees' && (isAdmin ? 'Team Attendance' : `${departmentInfo?.name || 'My Team'} Attendance`)}
              {view === 'calendar' && `${selectedEmployee?.firstName} ${selectedEmployee?.lastName}`}
            </h1>
            <p className="text-default-500 mt-1">
              {view === 'employees' && (isAdmin
                ? <>{`View attendance for all ${employees.length} employees${isDepartmentHead ? ' (your department shown first)' : ''}`} <BackgroundRefreshIndicator isValidating={attValidating} /></>
                : 'Select an employee to view their attendance calendar'
              )}
              {view === 'calendar' && <>'View attendance calendar and work hours' <BackgroundRefreshIndicator isValidating={attValidating} /></>}
            </p>
          </div>
        </div>
      </div>

      {/* Search Bar and Department Filter */}
      {view === 'employees' && (
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search Input */}
            <div className="flex-1">
              <Input
                type="text"
                placeholder="Search employees by name or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                startContent={<FaSearch className="text-default-400" />}
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-default-50 dark:bg-[#1E293B] shadow-none",
                }}
              />
            </div>

            {/* Department Filter for all users with multiple departments available */}
            {availableDepartments.length > 1 && (
              <div className="sm:w-72">
                <Select
                  selectedKeys={[selectedDepartmentFilter]}
                  onChange={(e) => { setSelectedDepartmentFilter(e.target.value); setSelectedTeamFilter('all') }}
                  aria-label="Department Filter"
                  placeholder="Filter by department"
                  startContent={<FaFilter className="text-default-400" />}
                  classNames={{ trigger: "bg-content1" }}
                >
                  <SelectItem key="all">All Departments ({employees.length})</SelectItem>
                  {availableDepartments.map((dept) => {
                    const count = employees.filter(e => (e.department?._id || e.department)?.toString() === dept._id.toString()).length
                    return (
                      <SelectItem key={dept._id} textValue={dept.name}>
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-3 h-3 rounded-full ${departmentColorMap[dept._id]?.badge || 'bg-gray-500'}`}
                          />
                          <span>{dept.name}</span>
                          <span className="text-default-400 ml-auto">({count})</span>
                        </div>
                      </SelectItem>
                    )
                  })}
                </Select>
              </div>
            )}

            {/* Team Filter */}
            {availableTeams.length > 0 && (
              <div className="sm:w-60">
                <Select
                  selectedKeys={[selectedTeamFilter]}
                  onChange={(e) => setSelectedTeamFilter(e.target.value)}
                  aria-label="Team Filter"
                  placeholder="Filter by team"
                  startContent={<FaUserFriends className="text-default-400" />}
                  classNames={{ trigger: "bg-content1" }}
                >
                  <SelectItem key="all">All Teams</SelectItem>
                  {availableTeams.map((team) => (
                    <SelectItem key={team._id}>
                      {team.teamName}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {/* Department Color Legend */}
          {availableDepartments.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {availableDepartments.slice(0, 10).map((dept) => (
                <Chip
                  key={dept._id}
                  size="sm"
                  variant="flat"
                  className={`${departmentColorMap[dept._id]?.bg || 'bg-gray-100'} ${departmentColorMap[dept._id]?.text || 'text-gray-700'}`}
                  startContent={
                    <div className={`w-2 h-2 rounded-full ${departmentColorMap[dept._id]?.badge || 'bg-gray-500'}`} />
                  }
                >
                  {dept.name}
                </Chip>
              ))}
              {availableDepartments.length > 10 && (
                <Chip size="sm" variant="flat" className="bg-default-100">
                  +{availableDepartments.length - 10} more
                </Chip>
              )}
            </div>
          )}
        </div>
      )}

      {/* Employees Grid */}
      {view === 'employees' && (
        <>
          {employeesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredEmployees.length === 0 ? (
                <div className="col-span-full text-center py-12 text-default-500">
                  <FaUsers className="w-12 h-12 mx-auto mb-4 text-default-300" />
                  <p>No employees found</p>
                </div>
              ) : (
                filteredEmployees.map((emp) => {
                  const empDeptId = (emp.department?._id || emp.department)?.toString()
                  const deptColor = departmentColorMap[empDeptId] || { bg: 'bg-default-100', border: 'border-default-300', text: 'text-default-700', badge: 'bg-default-500' }
                  const isHeadedDept = isDepartmentHead && headedDepartments.some(d => d._id?.toString() === empDeptId)

                  return (
                    <Card
                      key={emp._id}
                      isPressable
                      onPress={() => handleEmployeeClick(emp)}
                      className={`shadow-md hover:shadow-lg transition-all duration-200 border-l-4 ${deptColor.border} ${isHeadedDept ? 'ring-2 ring-primary ring-offset-1 dark:ring-offset-[#0F172A]' : ''}`}
                    >
                      <CardBody className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          {emp.profilePicture ? (
                            <img
                              src={emp.profilePicture}
                              alt={`${emp.firstName} ${emp.lastName}`}
                              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${deptColor.bg}`}>
                              <span className={`text-lg font-bold ${deptColor.text}`}>
                                {emp.firstName?.[0]}{emp.lastName?.[0]}
                              </span>
                            </div>
                          )}

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-default-800 truncate">
                              {emp.firstName} {emp.lastName}
                            </h3>
                            <p className="text-xs text-default-500 truncate">{emp.designation?.title || 'No Designation'}</p>
                            <p className="text-xs text-default-400">{emp.employeeCode || ''}</p>

                            {/* Department Badge */}
                            {emp.department?.name && (
                              <Chip
                                size="sm"
                                variant="flat"
                                className={`mt-2 ${deptColor.bg} ${deptColor.text}`}
                                startContent={
                                  <div className={`w-1.5 h-1.5 rounded-full ${deptColor.badge}`} />
                                }
                              >
                                {emp.department.name}
                              </Chip>
                            )}
                          </div>

                          {/* Action indicator */}
                          <div className="text-primary">
                            <FaCalendarAlt className="w-4 h-4" />
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  )
                })
              )}
            </div>
          )}
        </>
      )}

      {/* Employee Attendance Calendar */}
      {view === 'calendar' && selectedEmployee && (
        <Card className="shadow-md">
          <CardBody className="p-6">
            {/* Employee Info Card */}
            <div className="flex items-center space-x-4 mb-6 p-4 bg-default-50 rounded-lg">
              {selectedEmployee.avatar ? (
                <img
                  src={selectedEmployee.avatar}
                  alt={`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-xl font-bold text-primary">
                    {selectedEmployee.firstName?.[0]}{selectedEmployee.lastName?.[0]}
                  </span>
                </div>
              )}
              <div>
                <h2 className="text-xl font-semibold text-default-800">
                  {selectedEmployee.firstName} {selectedEmployee.lastName}
                </h2>
                <p className="text-sm text-default-500">{selectedEmployee.designation?.title || 'No Designation'}</p>
                <p className="text-xs text-default-400">{selectedEmployee.employeeCode || ''} • {selectedEmployee.email}</p>
              </div>
            </div>

            {/* Month Navigation */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center space-x-2">
                <Button
                  isIconOnly
                  variant="flat"
                  onPress={goToPreviousMonth}
                >
                  <FaChevronLeft />
                </Button>
                <span className="text-lg font-medium text-default-800 min-w-[160px] text-center">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <Button
                  isIconOnly
                  variant="flat"
                  onPress={goToNextMonth}
                >
                  <FaChevronRight />
                </Button>
              </div>
            </div>

            {/* Status Legend */}
            <div className="flex flex-wrap gap-3 mb-6 p-3 bg-default-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-success-100 border border-success"></div>
                <span className="text-xs text-default-600">Present</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-warning-100 border border-warning"></div>
                <span className="text-xs text-default-600">In Progress</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-warning-100 border border-warning"></div>
                <span className="text-xs text-default-600">Half Day</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-warning-100 border border-warning"></div>
                <span className="text-xs text-default-600">Late</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-danger-100 border border-danger"></div>
                <span className="text-xs text-default-600">Absent</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-primary-100 border border-primary"></div>
                <span className="text-xs text-default-600">On Leave</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-secondary-100 border border-secondary"></div>
                <span className="text-xs text-default-600">Holiday</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded bg-default-100 border border-default-300"></div>
                <span className="text-xs text-default-600">No Record</span>
              </div>
            </div>

            {/* Calendar Grid */}
            {attLoading ? (
              <div className="grid grid-cols-7 gap-2">
                {[...Array(35)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-visible p-2 -m-2">
                {/* Day Headers */}
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="text-center text-sm font-semibold text-default-500 py-2">
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
                        ${dayData.isToday ? 'ring-2 ring-primary ring-offset-2 dark:ring-offset-[#1E293B]' : ''}
                      `}
                    >
                      {dayData.day && (
                        <>
                          <div className="flex justify-between items-start mb-1">
                            <span className={`text-sm font-bold ${dayData.isToday ? 'text-primary' : 'text-default-700'}`}>
                              {dayData.day}
                            </span>
                          </div>

                          {dayData.record ? (
                            <div className="space-y-1">
                              <span className={`text-xs font-medium capitalize ${getStatusTextColor(dayData.record.status)}`}>
                                {dayData.record.status === 'in-progress' ? 'In Progress' : dayData.record.status}
                              </span>
                              <div className="text-[10px] text-default-500">
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
                              {/* Location indicators */}
                              {(dayData.record.location?.checkIn?.address || dayData.record.location?.checkOut?.address) && (
                                <div className="text-[9px] text-default-400 mt-1 space-y-0.5">
                                  {dayData.record.location?.checkIn?.address && (
                                    <div className="flex items-start gap-0.5" title={dayData.record.location.checkIn.address}>
                                      <FaMapMarkerAlt className="text-success w-2 h-2 mt-0.5 flex-shrink-0" />
                                      <span className="truncate max-w-[60px]">
                                        {dayData.record.location.checkIn.addressDetails?.city ||
                                          dayData.record.location.checkIn.address.split(',')[0]}
                                      </span>
                                    </div>
                                  )}
                                  {dayData.record.location?.checkOut?.address && (
                                    <div className="flex items-start gap-0.5" title={dayData.record.location.checkOut.address}>
                                      <FaMapMarkerAlt className="text-danger w-2 h-2 mt-0.5 flex-shrink-0" />
                                      <span className="truncate max-w-[60px]">
                                        {dayData.record.location.checkOut.addressDetails?.city ||
                                          dayData.record.location.checkOut.address.split(',')[0]}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : !dayData.isFuture ? (
                            <div className="text-xs text-default-400 mt-1">
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
            <div className="mt-6 pt-6 border-t border-default-200">
              <h3 className="text-lg font-semibold text-default-800 mb-4">Monthly Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-success-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-success-600">
                    {attendance.filter(r => r.status === 'present').length}
                  </p>
                  <p className="text-sm text-success-700">Present Days</p>
                </div>
                <div className="bg-danger-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-danger-600">
                    {attendance.filter(r => r.status === 'absent').length}
                  </p>
                  <p className="text-sm text-danger-700">Absent Days</p>
                </div>
                <div className="bg-warning-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-warning-600">
                    {attendance.filter(r => r.status === 'late').length}
                  </p>
                  <p className="text-sm text-warning-700">Late Days</p>
                </div>
                <div className="bg-secondary-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-secondary-600">
                    {attendance.filter(r => r.status === 'half-day').length}
                  </p>
                  <p className="text-sm text-secondary-700">Half Days</p>
                </div>
              </div>

              {/* Total Work Hours */}
              <div className="mt-4 bg-primary-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FaClock className="text-primary" />
                    <span className="text-primary-700 font-medium">Total Work Hours</span>
                  </div>
                  <span className="text-2xl font-bold text-primary">
                    {attendance.reduce((sum, r) => sum + (r.workHours || 0), 0).toFixed(1)}h
                  </span>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
