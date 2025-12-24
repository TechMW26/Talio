'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from '@/utils/toast'
import { FaClock, FaSignInAlt, FaSignOutAlt, FaCalendarAlt, FaEdit, FaCheck, FaTimes, FaExclamationCircle, FaPlus, FaChevronLeft, FaChevronRight, FaList, FaTh, FaMapMarkerAlt } from 'react-icons/fa'
import OvertimePrompt, { useOvertimeCheck } from '@/components/OvertimePrompt'
import ModalPortal from '@/components/ui/ModalPortal'
import useLocationCapture from '@/hooks/useLocationCapture'

export default function AttendancePage() {
  const [loading, setLoading] = useState(false)
  const [attendance, setAttendance] = useState([])
  const [todayAttendance, setTodayAttendance] = useState(null)
  const [user, setUser] = useState(null)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [viewMode, setViewMode] = useState('calendar') // 'calendar' or 'list'

  // Location capture hook
  const { captureLocation, loading: locationLoading, error: locationError, permissionStatus, checkPermission } = useLocationCapture()

  // Overtime check hook
  const { hasPendingRequest, pendingRequest, refresh: refreshOvertime } = useOvertimeCheck()
  const [showOvertimePrompt, setShowOvertimePrompt] = useState(false)

  // Correction modal state
  const [showCorrectionModal, setShowCorrectionModal] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [selectedDayForEdit, setSelectedDayForEdit] = useState(null)
  const [correctionForm, setCorrectionForm] = useState({
    correctionType: 'both',
    requestedCheckIn: '',
    requestedCheckOut: '',
    requestedStatus: '',
    reason: ''
  })
  const [submittingCorrection, setSubmittingCorrection] = useState(false)

  // My correction requests
  const [myCorrections, setMyCorrections] = useState([])
  const [showMyCorrections, setShowMyCorrections] = useState(false)

  // Pending approvals (for admins/HRs/dept heads)
  const [pendingCorrections, setPendingCorrections] = useState([])
  const [showPendingApprovals, setShowPendingApprovals] = useState(false)
  const [canApprove, setCanApprove] = useState(false)

  // Missing entry modal
  const [showMissingEntryModal, setShowMissingEntryModal] = useState(false)
  const [missingEntryForm, setMissingEntryForm] = useState({
    date: '',
    checkIn: '',
    checkOut: '',
    reason: ''
  })

  // Holidays state
  const [holidays, setHolidays] = useState([])
  const [selectedHoliday, setSelectedHoliday] = useState(null)
  const [showHolidayModal, setShowHolidayModal] = useState(false)

  // Fetch holidays
  useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const token = localStorage.getItem('token')
        const response = await fetch('/api/holidays?limit=100', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await response.json()
        if (data.success) {
          setHolidays(data.data)
        }
      } catch (error) {
        console.error('Error fetching holidays:', error)
      }
    }
    fetchHolidays()
  }, [])

  // Show overtime prompt when there's a pending request
  useEffect(() => {
    if (hasPendingRequest && pendingRequest) {
      setShowOvertimePrompt(true)
    }
  }, [hasPendingRequest, pendingRequest])

  // Auto-switch to list view on mobile
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])

  // Helper function to safely get employeeId
  const getEmployeeId = (userObj) => {
    if (!userObj) return null
    // Check if employeeId._id exists and is valid
    if (userObj.employeeId?._id && userObj.employeeId._id !== 'undefined') {
      return userObj.employeeId._id
    }
    // Check if employeeId is a direct string and is valid
    if (userObj.employeeId && typeof userObj.employeeId === 'string' && userObj.employeeId !== 'undefined') {
      return userObj.employeeId
    }
    // Fallback to user._id
    if (userObj._id && userObj._id !== 'undefined') {
      return userObj._id
    }
    // Fallback to user.id
    if (userObj.id && userObj.id !== 'undefined') {
      return userObj.id
    }
    return null
  }

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      console.log('📊 User object:', parsedUser)
      console.log('📊 employeeId field:', parsedUser.employeeId)
      console.log('📊 _id field:', parsedUser._id)

      setUser(parsedUser)
      // Handle both object and string formats for employeeId
      const empId = parsedUser.employeeId?._id || parsedUser.employeeId || parsedUser._id
      console.log('📊 Extracted empId:', empId)

      // Check if user can approve corrections
      const role = parsedUser.role
      if (['admin', 'hr', 'department_head', 'manager'].includes(role)) {
        setCanApprove(true)
        fetchPendingCorrections()
      }

      if (empId) {
        fetchTodayAttendance(empId)
        fetchAttendance(empId)
        fetchMyCorrections()
      } else {
        console.error('❌ No valid employee ID found in user object')
        toast.error('Employee ID not found. Please log in again.')
      }
    }
  }, [])

  const fetchMyCorrections = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/corrections?type=my', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setMyCorrections(data.data)
      }
    } catch (error) {
      console.error('Fetch my corrections error:', error)
    }
  }

  const fetchPendingCorrections = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/corrections?type=pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setPendingCorrections(data.data)
      }
    } catch (error) {
      console.error('Fetch pending corrections error:', error)
    }
  }

  const handleCorrectionRequest = async () => {
    if (!selectedRecord || !correctionForm.reason) {
      toast.error('Please provide a reason for the correction')
      return
    }

    setSubmittingCorrection(true)
    try {
      const token = localStorage.getItem('token')

      // Get the date from the selected record (use selectedDayForEdit or record date)
      const recordDate = selectedDayForEdit || selectedRecord.date
      const dateOnly = new Date(recordDate).toISOString().split('T')[0]

      // Build the full datetime strings using the record's date and user's time input
      let requestedCheckIn = undefined
      let requestedCheckOut = undefined

      if (correctionForm.requestedCheckIn && ['check-in', 'both'].includes(correctionForm.correctionType)) {
        // Combine the record date with the time input
        requestedCheckIn = `${dateOnly}T${correctionForm.requestedCheckIn}:00`
      }

      if (correctionForm.requestedCheckOut && ['check-out', 'both'].includes(correctionForm.correctionType)) {
        // Combine the record date with the time input
        requestedCheckOut = `${dateOnly}T${correctionForm.requestedCheckOut}:00`
      }

      const response = await fetch('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          attendanceId: selectedRecord._id,
          correctionType: correctionForm.correctionType,
          requestedCheckIn,
          requestedCheckOut,
          requestedStatus: correctionForm.requestedStatus || undefined,
          reason: correctionForm.reason
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Correction request submitted successfully')
        setShowCorrectionModal(false)
        setSelectedRecord(null)
        setSelectedDayForEdit(null)
        setCorrectionForm({ correctionType: 'both', requestedCheckIn: '', requestedCheckOut: '', requestedStatus: '', reason: '' })
        fetchMyCorrections()
      } else {
        toast.error(data.message || 'Failed to submit correction request')
      }
    } catch (error) {
      console.error('Correction request error:', error)
      toast.error('Failed to submit correction request')
    } finally {
      setSubmittingCorrection(false)
    }
  }

  const handleMissingEntryRequest = async () => {
    // Use selectedDayForMissingEntry if available, otherwise use form date
    const dateToUse = selectedDayForMissingEntry || missingEntryForm.date

    if (!dateToUse || !missingEntryForm.reason) {
      toast.error('Please provide date and reason')
      return
    }

    setSubmittingCorrection(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          date: dateToUse,
          correctionType: 'missing-entry',
          requestedCheckIn: missingEntryForm.checkIn ? `${dateToUse}T${missingEntryForm.checkIn}:00` : undefined,
          requestedCheckOut: missingEntryForm.checkOut ? `${dateToUse}T${missingEntryForm.checkOut}:00` : undefined,
          reason: missingEntryForm.reason
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Missing entry request submitted successfully')
        setShowMissingEntryModal(false)
        setSelectedDayForMissingEntry(null)
        setMissingEntryForm({ date: '', checkIn: '', checkOut: '', reason: '' })
        fetchMyCorrections()
      } else {
        toast.error(data.message || 'Failed to submit request')
      }
    } catch (error) {
      console.error('Missing entry request error:', error)
      toast.error('Failed to submit request')
    } finally {
      setSubmittingCorrection(false)
    }
  }

  const handleApproveReject = async (correctionId, action, comments = '') => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/corrections', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          correctionId,
          action,
          reviewerComments: comments
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Correction ${action}d successfully`)
        fetchPendingCorrections()
        fetchMyCorrections()
        // Refresh attendance data to show updated values after approval
        if (user && action === 'approve') {
          fetchAttendance(getEmployeeId(user))
          fetchTodayAttendance(getEmployeeId(user))
        }
      } else {
        toast.error(data.message || `Failed to ${action} correction`)
      }
    } catch (error) {
      console.error(`${action} correction error:`, error)
      toast.error(`Failed to ${action} correction`)
    }
  }

  // Helper function to format datetime for input (preserves local time)
  const formatDateTimeForInput = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    // Format as YYYY-MM-DDTHH:MM in local time
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  }

  // Helper function to format time only for input (HH:MM)
  const formatTimeForInput = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }

  // Helper function to format date as YYYY-MM-DD in local timezone
  const formatDateLocal = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // State to track selected day for missing entry
  const [selectedDayForMissingEntry, setSelectedDayForMissingEntry] = useState(null)

  const openCorrectionModal = (record) => {
    setSelectedRecord(record)
    setSelectedDayForEdit(record.date) // Store the date for the correction
    setCorrectionForm({
      correctionType: 'both',
      requestedCheckIn: formatTimeForInput(record.checkIn),
      requestedCheckOut: formatTimeForInput(record.checkOut),
      requestedStatus: record.status,
      reason: ''
    })
    setShowCorrectionModal(true)
  }

  const fetchTodayAttendance = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const today = new Date().toISOString().split('T')[0]
      const response = await fetch(
        `/api/attendance?employeeId=${employeeId}&date=${today}`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      )

      const data = await response.json()
      if (data.success && data.data.length > 0) {
        setTodayAttendance(data.data[0])
      }
    } catch (error) {
      console.error('Fetch today attendance error:', error)
    }
  }

  const fetchAttendance = async (employeeId, monthDate = currentMonth) => {
    try {
      const token = localStorage.getItem('token')
      const month = monthDate.getMonth() + 1
      const year = monthDate.getFullYear()

      const response = await fetch(
        `/api/attendance?employeeId=${employeeId}&month=${month}&year=${year}`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      )

      const data = await response.json()
      if (data.success) {
        setAttendance(data.data)
      }
    } catch (error) {
      console.error('Fetch attendance error:', error)
    }
  }

  // Calendar navigation
  const goToPreviousMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    setCurrentMonth(newMonth)
    if (user) {
      fetchAttendance(getEmployeeId(user), newMonth)
    }
  }

  const goToNextMonth = () => {
    const newMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    setCurrentMonth(newMonth)
    if (user) {
      fetchAttendance(getEmployeeId(user), newMonth)
    }
  }

  // Helper to format date as YYYY-MM-DD in local timezone (for use outside useMemo)
  const getLocalDateKeyHelper = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // Create pending corrections lookup map by date and attendance ID
  const pendingCorrectionsMap = useMemo(() => {
    const map = { byDate: {}, byAttendanceId: {} }
    myCorrections.forEach(correction => {
      if (correction.status === 'pending') {
        // Map by date
        if (correction.date) {
          const dateKey = getLocalDateKeyHelper(new Date(correction.date))
          map.byDate[dateKey] = correction
        }
        // Map by attendance ID
        if (correction.attendance?._id || correction.attendance) {
          const attendanceId = correction.attendance?._id || correction.attendance
          map.byAttendanceId[attendanceId] = correction
        }
      }
    })
    return map
  }, [myCorrections])

  // Helper to check if a day has a pending correction
  const getPendingCorrectionForDay = (dayData) => {
    if (!dayData) return null
    // Check by attendance ID first
    if (dayData.record?._id && pendingCorrectionsMap.byAttendanceId[dayData.record._id]) {
      return pendingCorrectionsMap.byAttendanceId[dayData.record._id]
    }
    // Check by date
    if (dayData.date && pendingCorrectionsMap.byDate[dayData.date]) {
      return pendingCorrectionsMap.byDate[dayData.date]
    }
    return null
  }

  // Helper to check if a record has a pending correction
  const getPendingCorrectionForRecord = (record) => {
    if (!record) return null
    // Check by attendance ID
    if (record._id && pendingCorrectionsMap.byAttendanceId[record._id]) {
      return pendingCorrectionsMap.byAttendanceId[record._id]
    }
    // Check by date
    if (record.date) {
      const dateKey = getLocalDateKeyHelper(new Date(record.date))
      if (pendingCorrectionsMap.byDate[dateKey]) {
        return pendingCorrectionsMap.byDate[dateKey]
      }
    }
    return null
  }

  // Calendar data generation
  const calendarData = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay()

    // Helper to format date as YYYY-MM-DD in local timezone
    const getLocalDateKey = (d) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    // Get today's date in local format
    const todayKey = getLocalDateKey(new Date())

    // Create attendance lookup map
    const attendanceMap = {}
    attendance.forEach(record => {
      const recordDate = new Date(record.date)
      const dateKey = getLocalDateKey(recordDate)
      attendanceMap[dateKey] = record
    })

    const days = []
    // Add empty cells for days before the first day of month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ day: null, date: null, record: null })
    }
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      const dateKey = getLocalDateKey(date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      date.setHours(0, 0, 0, 0)

      const record = attendanceMap[dateKey]

      // Find holiday for this date
      const holiday = holidays.find(h => {
        const hDate = new Date(h.date)
        return getLocalDateKey(hDate) === dateKey
      })

      days.push({
        date: date,
        day: day,
        isCurrentMonth: true,
        isToday: dateKey === todayKey,
        record: record || null,
        holiday: holiday || null
      })
    }

    return days
  }, [currentMonth, attendance, holidays])

  // Get status color for calendar cell
  const getStatusColor = (record, isFuture) => {
    if (isFuture) return 'bg-gray-50'
    if (!record) return 'bg-gray-100/80' // No record - potentially absent
    switch (record.status) {
      case 'present': return 'bg-green-100/70'
      case 'in-progress': return 'bg-orange-100/70'
      case 'half-day': return 'bg-yellow-100/70'
      case 'late': return 'bg-amber-100/70'
      case 'absent': return 'bg-red-100/70'
      case 'on-leave': return 'bg-blue-100/70'
      case 'holiday': return 'bg-purple-100/70'
      default: return 'bg-gray-100/70'
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

  const getStatusBadgeColor = (status) => {
    switch (status) {
      case 'present': return 'bg-green-100 text-green-800 border-green-200'
      case 'in-progress': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'half-day': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'late': return 'bg-amber-100 text-amber-800 border-amber-200'
      case 'absent': return 'bg-red-100 text-red-800 border-red-200'
      case 'on-leave': case 'leave': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'holiday': return 'bg-purple-100 text-purple-800 border-purple-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const openDayEditModal = (dayData) => {
    if (dayData.isFuture) return
    if (dayData.record) {
      openCorrectionModal(dayData.record)
    } else {
      // No record - open missing entry modal for this date
      setSelectedDayForMissingEntry(dayData.date)
      setMissingEntryForm({
        date: dayData.date,
        checkIn: '',
        checkOut: '',
        reason: ''
      })
      setShowMissingEntryModal(true)
    }
  }

  const handleClockIn = async () => {
    if (!user) return
    setLoading(true)

    try {
      // Capture location with high accuracy - REQUIRED for check-in
      let locationData = null

      try {
        locationData = await captureLocation()
      } catch (locationError) {
        setLoading(false)
        toast.error(locationError.message || 'Location is required for check-in. Please enable location services and try again.')
        return // Block check-in if location capture fails
      }

      if (!locationData || !locationData.latitude || !locationData.longitude) {
        setLoading(false)
        toast.error('Unable to capture location. Please enable location services and try again.')
        return
      }

      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeId: getEmployeeId(user),
          type: 'clock-in',
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: locationData.accuracy,
          // Address will be resolved server-side for accuracy
        }),
      })

      const data = await response.json()

      if (data.success) {
        const address = data.data?.location?.checkIn?.address || 'Location captured'
        toast.success(`Clocked in successfully\n📍 ${address}`, { duration: 4000 })
        setTodayAttendance(data.data)
        fetchAttendance(getEmployeeId(user))
      } else {
        if (data.requiresLocation) {
          toast.error('Location is required for attendance. Please enable location services.')
        } else {
          toast.error(data.message || 'Failed to clock in')
        }
      }
    } catch (error) {
      console.error('Clock in error:', error)
      toast.error('An error occurred while clocking in')
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!user) return
    setLoading(true)

    try {
      // Capture location with high accuracy - REQUIRED for check-out
      let locationData = null

      try {
        locationData = await captureLocation()
      } catch (locationError) {
        setLoading(false)
        toast.error(locationError.message || 'Location is required for check-out. Please enable location services and try again.')
        return // Block check-out if location capture fails
      }

      if (!locationData || !locationData.latitude || !locationData.longitude) {
        setLoading(false)
        toast.error('Unable to capture location. Please enable location services and try again.')
        return
      }

      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          employeeId: getEmployeeId(user),
          type: 'clock-out',
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: locationData.accuracy,
          // Address will be resolved server-side for accuracy
        }),
      })

      const data = await response.json()

      if (data.success) {
        const address = data.data?.location?.checkOut?.address || 'Location captured'
        toast.success(`Clocked out successfully\n📍 ${address}`, { duration: 4000 })
        setTodayAttendance(data.data)
        fetchAttendance(getEmployeeId(user))
      } else {
        if (data.requiresLocation) {
          toast.error('Location is required for attendance. Please enable location services.')
        } else {
          toast.error(data.message || 'Failed to clock out')
        }
      }
    } catch (error) {
      console.error('Clock out error:', error)
      toast.error('An error occurred while clocking out')
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Attendance</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">Track your attendance and work hours</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => setShowMissingEntryModal(true)}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm sm:text-base"
          >
            <FaPlus className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Report Missing Entry</span>
            <span className="sm:hidden">Missing Entry</span>
          </button>
          <button
            onClick={() => setShowMyCorrections(!showMyCorrections)}
            className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm sm:text-base"
          >
            <FaEdit className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">My Requests ({myCorrections.length})</span>
            <span className="sm:hidden">Requests ({myCorrections.length})</span>
          </button>
          {canApprove && pendingCorrections.length > 0 && (
            <button
              onClick={() => setShowPendingApprovals(!showPendingApprovals)}
              className="flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm sm:text-base"
            >
              <FaExclamationCircle className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Pending Approvals ({pendingCorrections.length})</span>
              <span className="sm:hidden">Approvals ({pendingCorrections.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Pending Approvals Section (for admins/HRs/dept heads) */}
      {showPendingApprovals && pendingCorrections.length > 0 && (
        <div className="bg-purple-50 rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6 border border-purple-200">
          <h2 className="text-lg sm:text-xl font-semibold text-purple-800 mb-4">Pending Correction Approvals</h2>
          <div className="space-y-4">
            {pendingCorrections.map((correction) => (
              <div key={correction._id} className="bg-white rounded-lg p-3 sm:p-4 border border-purple-100">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-sm sm:text-base text-gray-800">
                      {correction.employee?.firstName} {correction.employee?.lastName}
                    </p>
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      Date: {formatDate(correction.date)} | Type: {correction.correctionType}
                    </p>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1">
                      <strong>Current:</strong> {formatTime(correction.currentCheckIn)} - {formatTime(correction.currentCheckOut)} ({correction.currentStatus})
                    </p>
                    <p className="text-xs sm:text-sm text-blue-600 mt-1">
                      <strong>Requested:</strong> {correction.requestedCheckIn ? formatTime(correction.requestedCheckIn) : 'N/A'} - {correction.requestedCheckOut ? formatTime(correction.requestedCheckOut) : 'N/A'} {correction.requestedStatus ? `(${correction.requestedStatus})` : ''}
                    </p>
                    <p className="text-xs sm:text-sm text-gray-600 mt-2 italic line-clamp-2">&quot;{correction.reason}&quot;</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleApproveReject(correction._id, 'approve')}
                      className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                      title="Approve"
                    >
                      <FaCheck className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        const comment = prompt('Reason for rejection (optional):')
                        handleApproveReject(correction._id, 'reject', comment || '')
                      }}
                      className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                      title="Reject"
                    >
                      <FaTimes className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Correction Requests */}
      {showMyCorrections && (
        <div className="bg-blue-50 rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6 border border-blue-200">
          <h2 className="text-lg sm:text-xl font-semibold text-blue-800 mb-4">My Correction Requests</h2>
          {myCorrections.length === 0 ? (
            <p className="text-sm sm:text-base text-gray-500">No correction requests submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {myCorrections.map((correction) => (
                <div key={correction._id} className="bg-white rounded-lg p-3 sm:p-4 border border-blue-100">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
                    <div className="flex-1">
                      <p className="font-medium text-sm sm:text-base text-gray-800">{formatDate(correction.date)}</p>
                      <p className="text-xs sm:text-sm text-gray-600">Type: {correction.correctionType}</p>
                      <p className="text-xs sm:text-sm text-gray-500 italic line-clamp-2">&quot;{correction.reason}&quot;</p>
                    </div>
                    <span className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-full whitespace-nowrap self-start ${correction.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        correction.status === 'approved' ? 'bg-green-100 text-green-800' :
                          'bg-red-100 text-red-800'
                      }`}>
                      {correction.status}
                    </span>
                  </div>
                  {correction.reviewerComments && (
                    <p className="text-xs sm:text-sm text-gray-500 mt-2">
                      <strong>Reviewer:</strong> {correction.reviewerComments}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clock In/Out Card */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="w-full lg:w-auto">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 mb-3">Today&apos;s Attendance</h2>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 text-sm sm:text-base text-gray-600">
              <div className="flex items-center gap-2">
                <FaClock className="text-primary-500 w-4 h-4" />
                <span>Check In: {formatTime(todayAttendance?.checkIn)}</span>
              </div>
              <div className="flex items-center gap-2">
                <FaClock className="text-primary-500 w-4 h-4" />
                <span>Check Out: {formatTime(todayAttendance?.checkOut)}</span>
              </div>
              {todayAttendance?.workHours && (
                <div className="flex items-center gap-2">
                  <FaClock className="text-green-500 w-4 h-4" />
                  <span className="font-semibold">
                    Work Hours: {todayAttendance.workHours}h
                  </span>
                </div>
              )}
            </div>
            {/* Location Display */}
            {(todayAttendance?.location?.checkIn?.address || todayAttendance?.location?.checkOut?.address) && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex flex-col gap-2 text-xs sm:text-sm">
                  {todayAttendance?.location?.checkIn?.address && (
                    <div className="flex items-start gap-2 text-gray-600">
                      <FaMapMarkerAlt className="text-green-500 w-3 h-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="font-medium text-gray-700">Check-in: </span>
                        <span className="text-gray-600">{todayAttendance.location.checkIn.address}</span>
                      </div>
                    </div>
                  )}
                  {todayAttendance?.location?.checkOut?.address && (
                    <div className="flex items-start gap-2 text-gray-600">
                      <FaMapMarkerAlt className="text-red-500 w-3 h-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="font-medium text-gray-700">Check-out: </span>
                        <span className="text-gray-600">{todayAttendance.location.checkOut.address}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            <button
              onClick={handleClockIn}
              disabled={loading || locationLoading || (todayAttendance && todayAttendance.checkIn)}
              className="btn-theme-primary flex items-center justify-center gap-2 px-6 py-3 sm:p-8 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold shadow-md hover:shadow-lg transition-all duration-200 text-sm sm:text-base"
            >
              <FaSignInAlt className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>{loading || locationLoading ? 'Getting Location...' : 'Clock In'}</span>
            </button>
            <button
              onClick={handleClockOut}
              disabled={loading || locationLoading || !todayAttendance || !todayAttendance.checkIn || todayAttendance.checkOut}
              className="btn-theme-secondary flex items-center justify-center gap-2 px-6 py-3 sm:p-8 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold shadow-md hover:shadow-lg transition-all duration-200 text-sm sm:text-base"
            >
              <FaSignOutAlt className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>{loading || locationLoading ? 'Getting Location...' : 'Clock Out'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Attendance History - Calendar & List View */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 sm:mb-6 gap-3 sm:gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800">My Attendance - {user?.firstName} {user?.lastName}</h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">Click on any day to edit or report missing entry</p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto">
            {/* View Toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1 w-full sm:w-auto">
              <button
                onClick={() => setViewMode('calendar')}
                className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex-1 sm:flex-initial ${viewMode === 'calendar' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                <FaTh className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>Calendar</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors flex-1 sm:flex-initial ${viewMode === 'list' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                <FaList className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>List</span>
              </button>
            </div>

            {/* Month Navigation */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={goToPreviousMonth}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <FaChevronLeft className="w-3 h-3 sm:w-4 sm:h-4" />
              </button>
              <span className="text-sm sm:text-lg font-medium text-gray-800 min-w-[120px] sm:min-w-[140px] text-center">
                {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={goToNextMonth}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <FaChevronRight className="w-3 h-3 sm:w-4 sm:h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Status Legend */}
        <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 sm:mb-6 p-2 sm:p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-green-100 border border-green-400"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">Present</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-orange-100 border border-orange-400"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">In Progress</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-yellow-100 border border-yellow-400"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">Half Day</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-amber-100 border border-amber-400"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">Late</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-red-100 border border-red-400"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">Absent</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-blue-100 border border-blue-400"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">On Leave</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-purple-100 border border-purple-400"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">Holiday</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-gray-100 border border-gray-300"></div>
            <span className="text-[10px] sm:text-xs text-gray-600">No Record</span>
          </div>
        </div>

        {viewMode === 'calendar' ? (
          /* Calendar View */
          <div className="overflow-x-auto overflow-y-visible">
            <div className="min-w-[700px] p-2">
              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="text-center text-xs sm:text-sm font-semibold text-gray-500 py-2">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarData.map((dayData, index) => {
                  const pendingCorrection = dayData.day ? getPendingCorrectionForDay(dayData) : null
                  const hasPending = !!pendingCorrection
                  const isWeekend = dayData.date ? (dayData.date.getDay() === 0 || dayData.date.getDay() === 6) : false
                  const isHoliday = dayData.record?.status === 'holiday' || dayData.holiday
                  const holidayName = dayData.holiday?.name || (dayData.record?.status === 'holiday' ? 'Holiday' : '')

                  // Determine status color
                  let statusColor = 'bg-gray-50'
                  if (dayData.record) {
                    if (dayData.record.status === 'present') statusColor = 'bg-green-50 border-green-100'
                    else if (dayData.record.status === 'absent') statusColor = 'bg-red-50 border-red-100'
                    else if (dayData.record.status === 'late') statusColor = 'bg-yellow-50 border-yellow-100'
                    else if (dayData.record.status === 'half-day') statusColor = 'bg-orange-50 border-orange-100'
                    else if (dayData.record.status === 'leave') statusColor = 'bg-blue-50 border-blue-100'
                    else if (dayData.record.status === 'holiday') statusColor = 'bg-purple-50 border-purple-100'
                  } else if (isHoliday) {
                    statusColor = 'bg-purple-50 border-purple-100'
                  }

                  return (
                    <div
                      key={index}
                      onClick={() => {
                        if (dayData.holiday) {
                          setSelectedHoliday(dayData.holiday)
                          setShowHolidayModal(true)
                        } else if (dayData.record) {
                          setSelectedRecord(dayData.record)
                          setShowDetailsModal(true)
                        } else if (dayData.isCurrentMonth && !isWeekend && !isHoliday && new Date(dayData.date) < new Date()) {
                          // Handle missing entry click
                          setMissingEntryForm(prev => ({
                            ...prev,
                            date: dayData.date.toISOString().split('T')[0]
                          }))
                          setShowMissingEntryModal(true)
                        }
                      }}
                      className={`
                      min-h-[80px] sm:min-h-[120px] p-1.5 sm:p-2 border rounded transition-all cursor-pointer relative group
                      ${statusColor}
                      ${dayData.isToday ? 'ring-2 ring-blue-500' : ''}
                      ${!dayData.isCurrentMonth ? 'opacity-40 bg-gray-50 border-transparent' : 'bg-white hover:shadow'}
                    `}
                    >
                      {/* Day number */}
                      <div className="font-bold text-xs sm:text-sm mb-1">
                        <span className={dayData.isToday ? 'text-blue-600' : 'text-gray-700'}>
                          {dayData.day}
                        </span>
                      </div>

                      {/* Status badge */}
                      {dayData.record?.status && (
                        <div className="mb-1">
                          <span className={`
                          inline-block text-[9px] sm:text-[10px] px-1 py-0.5 rounded border font-medium uppercase tracking-tight leading-tight
                          ${getStatusBadgeColor(dayData.record.status)}
                          break-words max-w-full
                        `} style={{ wordBreak: 'break-word', hyphens: 'auto' }}>
                            {dayData.record.status}
                          </span>
                        </div>
                      )}

                      {/* Edit button for regularisation - show on hover */}
                      {dayData.isCurrentMonth && dayData.record && !isHoliday && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openCorrectionModal(dayData.record)
                          }}
                          className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 p-0.5 sm:p-1 rounded-full bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 z-10"
                          title="Request Regularisation"
                        >
                          <FaEdit className="w-2 h-2 sm:w-3 sm:h-3 text-blue-600" />
                        </button>
                      )}

                      {/* Pending correction indicator */}
                      {hasPending && (
                        <div className="absolute bottom-0.5 sm:bottom-1 right-0.5 sm:right-1">
                          <span className="text-[7px] sm:text-[8px] px-0.5 sm:px-1 py-0.5 bg-yellow-400 text-yellow-900 rounded font-medium">
                            Pending
                          </span>
                        </div>
                      )}

                      {/* Add button for missing entry - show on hover for past dates without records */}
                      {dayData.isCurrentMonth && !dayData.record && !isWeekend && !isHoliday && dayData.date && new Date(dayData.date) < new Date() && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setMissingEntryForm(prev => ({
                              ...prev,
                              date: dayData.date.toISOString().split('T')[0]
                            }))
                            setShowMissingEntryModal(true)
                          }}
                          className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 p-0.5 sm:p-1 rounded-full bg-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-50 z-10"
                          title="Add Missing Entry"
                        >
                          <FaPlus className="w-2 h-2 sm:w-3 sm:h-3 text-green-600" />
                        </button>
                      )}

                      {/* Holiday Name */}
                      {isHoliday && (
                        <div className="text-[9px] sm:text-[10px] leading-tight text-purple-700 mt-1 font-medium bg-purple-100/50 px-1 py-0.5 rounded break-words" style={{ wordBreak: 'break-word', hyphens: 'auto' }}>
                          {holidayName}
                        </div>
                      )}

                      {/* Time details for present/late/half-day */}
                      {dayData.record && ['present', 'late', 'half-day'].includes(dayData.record.status) && (
                        <div className="text-[9px] sm:text-[10px] text-gray-600 mt-1 space-y-0.5 max-h-[50px] sm:max-h-[70px] overflow-y-auto overflow-x-hidden">
                          {dayData.record.checkIn && (
                            <div className="truncate" title={`In: ${formatTime(dayData.record.checkIn)}`}>In: {formatTime(dayData.record.checkIn)}</div>
                          )}
                          {dayData.record.checkOut && (
                            <div className="truncate" title={`Out: ${formatTime(dayData.record.checkOut)}`}>Out: {formatTime(dayData.record.checkOut)}</div>
                          )}
                          {dayData.record.workHours && (
                            <div className="font-medium truncate">{dayData.record.workHours}h</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          /* List View */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check In</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check Out</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">Locations</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {attendance.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-4 py-4 text-center text-gray-500">
                      No attendance records found for this month
                    </td>
                  </tr>
                ) : (
                  attendance.map((record) => {
                    const pendingCorrection = getPendingCorrectionForRecord(record)
                    const hasPending = !!pendingCorrection

                    return (
                      <tr key={record._id} className={`hover:bg-gray-50 ${hasPending ? 'bg-yellow-50' : ''}`}>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{formatDate(record.date)}</td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{formatTime(record.checkIn)}</td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{formatTime(record.checkOut)}</td>
                        <td className="px-4 py-4 text-xs text-gray-600 hidden md:table-cell max-w-xs">
                          {record.location?.checkIn?.address || record.location?.checkOut?.address ? (
                            <div className="space-y-1">
                              {record.location?.checkIn?.address && (
                                <div className="flex items-start gap-1">
                                  <FaMapMarkerAlt className="text-green-500 mt-0.5 flex-shrink-0 w-3 h-3" />
                                  <span className="truncate" title={record.location.checkIn.address}>
                                    {record.location.checkIn.address.length > 40
                                      ? record.location.checkIn.address.substring(0, 40) + '...'
                                      : record.location.checkIn.address}
                                  </span>
                                </div>
                              )}
                              {record.location?.checkOut?.address && (
                                <div className="flex items-start gap-1">
                                  <FaMapMarkerAlt className="text-red-500 mt-0.5 flex-shrink-0 w-3 h-3" />
                                  <span className="truncate" title={record.location.checkOut.address}>
                                    {record.location.checkOut.address.length > 40
                                      ? record.location.checkOut.address.substring(0, 40) + '...'
                                      : record.location.checkOut.address}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">Not captured</span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{record.workHours ? `${record.workHours}h` : 'N/A'}</td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${record.status === 'present' ? 'bg-green-100 text-green-800' :
                              record.status === 'absent' ? 'bg-red-100 text-red-800' :
                                record.status === 'half-day' ? 'bg-yellow-100 text-yellow-800' :
                                  record.status === 'in-progress' ? 'bg-orange-100 text-orange-800' :
                                    record.status === 'late' ? 'bg-amber-100 text-amber-800' :
                                      record.status === 'on-leave' ? 'bg-blue-100 text-blue-800' :
                                        'bg-gray-100 text-gray-800'
                            }`}>
                            {record.status === 'in-progress' ? 'In Progress' : record.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          {hasPending ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium border border-yellow-300">
                              <FaClock className="w-3 h-3" />
                              <span>Pending</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => openCorrectionModal(record)}
                              className="text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                              title="Request Correction"
                            >
                              <FaEdit />
                              <span className="text-sm">Correct</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
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
        </div>
      </div>

      {/* Correction Request Modal */}
      <ModalPortal isOpen={showCorrectionModal && selectedRecord}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && (setShowCorrectionModal(false), setSelectedRecord(null), setSelectedDayForEdit(null))}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h3 className="modal-title">Request Attendance Correction</h3>
              <button onClick={() => { setShowCorrectionModal(false); setSelectedRecord(null); setSelectedDayForEdit(null); }} className="modal-close-btn">
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              {/* Display the date from selectedRecord - not editable */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-medium text-blue-800">
                  <FaCalendarAlt className="inline mr-2" />
                  Date: {selectedRecord && formatDate(selectedRecord.date)}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Current: {selectedRecord && formatTime(selectedRecord.checkIn)} - {selectedRecord && formatTime(selectedRecord.checkOut)} ({selectedRecord?.status})
                </p>
                {/* Location Display in Modal */}
                {(selectedRecord?.location?.checkIn?.address || selectedRecord?.location?.checkOut?.address) && (
                  <div className="mt-2 pt-2 border-t border-blue-200">
                    {selectedRecord?.location?.checkIn?.address && (
                      <p className="text-xs text-blue-600 flex items-start gap-1">
                        <FaMapMarkerAlt className="text-green-600 mt-0.5 flex-shrink-0" />
                        <span><strong>Check-in:</strong> {selectedRecord.location.checkIn.address}</span>
                      </p>
                    )}
                    {selectedRecord?.location?.checkOut?.address && (
                      <p className="text-xs text-blue-600 flex items-start gap-1 mt-1">
                        <FaMapMarkerAlt className="text-red-600 mt-0.5 flex-shrink-0" />
                        <span><strong>Check-out:</strong> {selectedRecord.location.checkOut.address}</span>
                      </p>
                    )}
                  </div>
                )}
                {/* Show "Location not captured" for old records */}
                {selectedRecord && !selectedRecord?.location?.checkIn?.address && !selectedRecord?.location?.checkOut?.address && (
                  <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-blue-200 flex items-center gap-1">
                    <FaMapMarkerAlt className="text-gray-400" />
                    <span>Location not captured</span>
                  </p>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="modal-label">Correction Type</label>
                  <select
                    value={correctionForm.correctionType}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, correctionType: e.target.value })}
                    className="modal-select"
                  >
                    <option value="check-in">Check-In Time</option>
                    <option value="check-out">Check-Out Time</option>
                    <option value="both">Both Times</option>
                    <option value="status">Status Only</option>
                  </select>
                </div>

                {['check-in', 'both'].includes(correctionForm.correctionType) && (
                  <div>
                    <label className="modal-label">Correct Check-In Time</label>
                    <input
                      type="time"
                      value={correctionForm.requestedCheckIn}
                      onChange={(e) => setCorrectionForm({ ...correctionForm, requestedCheckIn: e.target.value })}
                      className="modal-input"
                    />
                  </div>
                )}

                {['check-out', 'both'].includes(correctionForm.correctionType) && (
                  <div>
                    <label className="modal-label">Correct Check-Out Time</label>
                    <input
                      type="time"
                      value={correctionForm.requestedCheckOut}
                      onChange={(e) => setCorrectionForm({ ...correctionForm, requestedCheckOut: e.target.value })}
                      className="modal-input"
                    />
                  </div>
                )}

                {correctionForm.correctionType === 'status' && (
                  <div>
                    <label className="modal-label">Requested Status</label>
                    <select
                      value={correctionForm.requestedStatus}
                      onChange={(e) => setCorrectionForm({ ...correctionForm, requestedStatus: e.target.value })}
                      className="modal-select"
                    >
                      <option value="present">Present</option>
                      <option value="half-day">Half Day</option>
                      <option value="on-leave">On Leave</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="modal-label">Reason for Correction *</label>
                  <textarea
                    value={correctionForm.reason}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                    placeholder="Please explain why this correction is needed..."
                    rows={3}
                    className="modal-textarea"
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowCorrectionModal(false)
                  setSelectedRecord(null)
                  setSelectedDayForEdit(null)
                }}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCorrectionRequest}
                disabled={submittingCorrection || !correctionForm.reason}
                className="modal-btn modal-btn-primary"
              >
                {submittingCorrection ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

      {/* Missing Entry Modal */}
      {/* Missing Entry Modal */}
      <ModalPortal isOpen={showMissingEntryModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && (setShowMissingEntryModal(false), setSelectedDayForMissingEntry(null), setMissingEntryForm({ date: '', checkIn: '', checkOut: '', reason: '' }))}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h3 className="modal-title">Report Missing Entry</h3>
              <button onClick={() => { setShowMissingEntryModal(false); setSelectedDayForMissingEntry(null); setMissingEntryForm({ date: '', checkIn: '', checkOut: '', reason: '' }); }} className="modal-close-btn">
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm text-gray-600 mb-4">Submit a request to add attendance for a day you forgot to clock in/out.</p>

              <div className="space-y-4">
                {/* Show date as read-only info box when selected from calendar */}
                {selectedDayForMissingEntry ? (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-orange-800">
                      <FaCalendarAlt className="inline mr-2" />
                      Date: {formatDate(selectedDayForMissingEntry)}
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="modal-label">Date *</label>
                    <input
                      type="date"
                      value={missingEntryForm.date}
                      onChange={(e) => setMissingEntryForm({ ...missingEntryForm, date: e.target.value })}
                      max={formatDateLocal(new Date())}
                      className="modal-input"
                    />
                  </div>
                )}

                <div>
                  <label className="modal-label">Check-In Time</label>
                  <input
                    type="time"
                    value={missingEntryForm.checkIn}
                    onChange={(e) => setMissingEntryForm({ ...missingEntryForm, checkIn: e.target.value })}
                    className="modal-input"
                  />
                </div>

                <div>
                  <label className="modal-label">Check-Out Time</label>
                  <input
                    type="time"
                    value={missingEntryForm.checkOut}
                    onChange={(e) => setMissingEntryForm({ ...missingEntryForm, checkOut: e.target.value })}
                    className="modal-input"
                  />
                </div>

                <div>
                  <label className="modal-label">Reason *</label>
                  <textarea
                    value={missingEntryForm.reason}
                    onChange={(e) => setMissingEntryForm({ ...missingEntryForm, reason: e.target.value })}
                    placeholder="Why did you miss clocking in/out?"
                    rows={3}
                    className="modal-textarea"
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowMissingEntryModal(false)
                  setSelectedDayForMissingEntry(null)
                  setMissingEntryForm({ date: '', checkIn: '', checkOut: '', reason: '' })
                }}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleMissingEntryRequest}
                disabled={submittingCorrection || (!selectedDayForMissingEntry && !missingEntryForm.date) || !missingEntryForm.reason}
                className="modal-btn modal-btn-primary"
                style={{ backgroundColor: '#f97316' }}
              >
                {submittingCorrection ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

      {/* Overtime Prompt Modal */}
      {showOvertimePrompt && (
        <OvertimePrompt
          userId={user?._id}
          onClose={() => {
            setShowOvertimePrompt(false)
            refreshOvertime()
          }}
          onResponse={(isOvertime, data) => {
            if (!isOvertime && data?.checkOutTime) {
              // Refresh attendance data if user was clocked out
              if (user) {
                fetchAttendance(getEmployeeId(user))
                fetchTodayAttendance(getEmployeeId(user))
              }
            }
          }}
        />
      )}

      {/* Holiday Details Modal */}
      {showHolidayModal && selectedHoliday && (
        <ModalPortal onClose={() => setShowHolidayModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-800">{selectedHoliday.name}</h3>
              <button
                onClick={() => setShowHolidayModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-100 rounded-full"
              >
                <FaTimes size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center p-3 bg-purple-50 rounded-lg border border-purple-100">
                <div className="bg-white p-2 rounded-full shadow-sm mr-3">
                  <FaCalendarAlt className="text-purple-600" size={18} />
                </div>
                <div>
                  <p className="text-xs text-purple-600 font-semibold uppercase tracking-wide">Date</p>
                  <p className="text-gray-800 font-medium">
                    {new Date(selectedHoliday.date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </p>
                </div>
              </div>

              {selectedHoliday.description ? (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Description</h4>
                  <p className="text-gray-600 text-sm leading-relaxed">
                    {selectedHoliday.description}
                  </p>
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500 italic bg-gray-50 rounded-lg">
                  No description available for this holiday.
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <span className="px-3 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full capitalize border border-purple-200 shadow-sm">
                  {selectedHoliday.type || 'Public Holiday'}
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowHolidayModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
}

