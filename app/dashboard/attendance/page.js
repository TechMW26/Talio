'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import toast from '@/utils/toast'
import { FaClock, FaSignInAlt, FaSignOutAlt, FaCalendarAlt, FaEdit, FaCheck, FaTimes, FaExclamationCircle, FaPlus, FaChevronLeft, FaChevronRight, FaList, FaTh, FaMapMarkerAlt } from 'react-icons/fa'
import OvertimePrompt, { useOvertimeCheck } from '@/components/OvertimePrompt'
import useLocationCapture from '@/hooks/useLocationCapture'
import { useSocket } from '@/contexts/SocketContext'
import { Card, CardBody, CardHeader, CardFooter, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Textarea, Select, SelectItem } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'

export default function AttendancePage() {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [viewMode, setViewMode] = useState('calendar') // 'calendar' or 'list'

  // Socket.IO for real-time updates
  const { socket, isConnected } = useSocket()

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
  const [submittingCorrection] = useState(false) // kept for backward compat but unused now

  // Pending approvals (for admins/HRs/dept heads)
  const [showMyCorrections, setShowMyCorrections] = useState(false)
  const [showPendingApprovals, setShowPendingApprovals] = useState(false)

  // Missing entry modal
  const [showMissingEntryModal, setShowMissingEntryModal] = useState(false)
  const [missingEntryForm, setMissingEntryForm] = useState({
    date: '',
    checkIn: '',
    checkOut: '',
    reason: ''
  })

  // Holidays state
  const [selectedHoliday, setSelectedHoliday] = useState(null)
  const [showHolidayModal, setShowHolidayModal] = useState(false)

  // Details modal state (for viewing attendance record details)
  const [showDetailsModal, setShowDetailsModal] = useState(false)

  // Helper function to safely get employeeId - defined early for use in useEffects
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

  // User from localStorage (memoized)
  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    const userData = localStorage.getItem('user')
    return userData ? JSON.parse(userData) : null
  }, [])

  const employeeId = useMemo(() => user ? getEmployeeId(user) : null, [user])

  const canApprove = useMemo(() => {
    if (!user) return false
    return ['admin', 'hr', 'department_head', 'manager'].includes(user.role)
  }, [user])

  // Set mounted state for hydration
  useEffect(() => {
    setMounted(true)
  }, [])

  // --- SWR Data Fetching ---

  // Company settings (independent)
  const { data: companySettingsRes } = useAuthedSWR('/api/company/settings')
  const workingDays = companySettingsRes?.data?.workingHours?.workingDays || [1, 2, 3, 4, 5]

  // Employee details (depends on user)
  const { data: employeeDetailsRes } = useAuthedSWR(employeeId ? `/api/employees/${employeeId}` : null)
  const employeeJoiningDate = useMemo(() => {
    const jd = employeeDetailsRes?.data?.joiningDate
    return jd ? new Date(jd) : null
  }, [employeeDetailsRes])

  // Holidays (independent)
  const { data: holidaysRes } = useAuthedSWR('/api/holidays?limit=100')
  const holidays = holidaysRes?.data || []

  // Today's attendance (depends on employeeId)
  const todayDateStr = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }, [])
  const { data: todayAttendanceRes, mutate: mutateTodayAttendance } = useAuthedSWR(
    employeeId ? `/api/attendance?employeeId=${employeeId}&date=${todayDateStr}` : null
  )
  const todayAttendance = todayAttendanceRes?.data?.[0] || null

  // Monthly attendance (depends on employeeId + currentMonth)
  const monthNum = currentMonth.getMonth() + 1
  const yearNum = currentMonth.getFullYear()
  const { data: attendanceRes, mutate: mutateAttendance } = useAuthedSWR(
    employeeId ? `/api/attendance?employeeId=${employeeId}&month=${monthNum}&year=${yearNum}` : null
  )
  const attendance = attendanceRes?.data || []

  // My corrections
  const { data: myCorrectionsRes, mutate: mutateMyCorrections } = useAuthedSWR('/api/attendance/corrections?type=my')
  const myCorrections = myCorrectionsRes?.data || []

  // Pending corrections (admin only)
  const { data: pendingCorrectionsRes, mutate: mutatePendingCorrections } = useAuthedSWR(
    canApprove ? '/api/attendance/corrections?type=pending' : null
  )
  const pendingCorrections = pendingCorrectionsRes?.data || []

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

  // Socket.IO listener for real-time attendance updates
  // This handles when corrections are approved/rejected
  useEffect(() => {
    if (!socket || !isConnected || !user) return

    const handleAttendanceUpdate = (data) => {
      try {
        console.log('📡 Real-time attendance update received:', data)

        const empId = getEmployeeId(user)

        // Check if this update is for the current user
        if (data.employeeId === empId) {
          // Refresh attendance data via SWR
          mutateTodayAttendance()
          mutateAttendance()
          mutateMyCorrections()

          // Show toast notification
          if (data.type === 'correction-approved') {
            toast.success(data.message || 'Your attendance correction has been approved!', {
              duration: 5000,
              icon: '✅'
            })
          } else if (data.type === 'correction-rejected') {
            toast.error(data.message || 'Your attendance correction has been rejected.', {
              duration: 5000,
              icon: '❌'
            })
          }
        }
      } catch (error) {
        console.error('[Attendance] Error handling attendance update:', error)
      }
    }

    // Listen for real-time attendance-update events (check-in/check-out from other tabs/desktop)
    const handleRealtimeAttendanceSync = (data) => {
      try {
        if (data?.attendance) {
          console.log('📡 Real-time attendance sync (check-in/out):', data)
          mutateTodayAttendance()
          mutateAttendance()
        }
      } catch (error) {
        console.error('[Attendance] Error handling realtime attendance sync:', error)
      }
    }

    socket.on('attendance-updated', handleAttendanceUpdate)
    socket.on('attendance-update', handleRealtimeAttendanceSync)
    console.log('📡 Listening for attendance-updated and attendance-update events')

    return () => {
      socket.off('attendance-updated', handleAttendanceUpdate)
      socket.off('attendance-update', handleRealtimeAttendanceSync)
    }
  }, [socket, isConnected, user])

  // --- Correction mutation ---
  const correctionMutation = useApiMutation({
    invalidateKeys: ['/api/attendance/corrections?type=my'],
    onSuccess: (data) => {
      toast.success('Correction request submitted successfully')
      setShowCorrectionModal(false)
      setSelectedRecord(null)
      setSelectedDayForEdit(null)
      setCorrectionForm({ correctionType: 'both', requestedCheckIn: '', requestedCheckOut: '', requestedStatus: '', reason: '' })
    },
    onError: (msg) => toast.error(msg || 'Failed to submit correction request'),
  })

  const handleCorrectionRequest = async () => {
    if (!selectedRecord || !correctionForm.reason) {
      toast.error('Please provide a reason for the correction')
      return
    }

    // Get the date from the selected record (use selectedDayForEdit or record date)
    const recordDate = selectedDayForEdit || selectedRecord.date

    // Format date in local timezone (avoid UTC conversion issues)
    const dateObj = new Date(recordDate)
    const year = dateObj.getFullYear()
    const month = String(dateObj.getMonth() + 1).padStart(2, '0')
    const day = String(dateObj.getDate()).padStart(2, '0')
    const dateOnly = `${year}-${month}-${day}`

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

    const response = await correctionMutation.execute('/api/attendance/corrections', {
      attendanceId: selectedRecord._id,
      correctionType: correctionForm.correctionType,
      requestedCheckIn,
      requestedCheckOut,
      requestedStatus: correctionForm.requestedStatus || undefined,
      reason: correctionForm.reason
    })
  }

  // --- Missing entry mutation ---
  const missingEntryMutation = useApiMutation({
    invalidateKeys: ['/api/attendance/corrections?type=my'],
    onSuccess: (data) => {
      toast.success('Missing entry request submitted successfully')
      setShowMissingEntryModal(false)
      setSelectedDayForMissingEntry(null)
      setMissingEntryForm({ date: '', checkIn: '', checkOut: '', reason: '' })
    },
    onError: (msg) => toast.error(msg || 'Failed to submit request'),
  })

  const handleMissingEntryRequest = async () => {
    // Use selectedDayForMissingEntry if available, otherwise use form date
    const rawDate = selectedDayForMissingEntry || missingEntryForm.date

    if (!rawDate || !missingEntryForm.reason) {
      toast.error('Please provide date and reason')
      return
    }

    // Ensure dateToUse is a YYYY-MM-DD string (selectedDayForMissingEntry is a Date object)
    let dateToUse
    if (rawDate instanceof Date) {
      dateToUse = `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`
    } else {
      dateToUse = rawDate
    }

    await missingEntryMutation.execute('/api/attendance/corrections', {
      date: dateToUse,
      correctionType: 'missing-entry',
      requestedCheckIn: missingEntryForm.checkIn ? `${dateToUse}T${missingEntryForm.checkIn}:00` : undefined,
      requestedCheckOut: missingEntryForm.checkOut ? `${dateToUse}T${missingEntryForm.checkOut}:00` : undefined,
      reason: missingEntryForm.reason
    })
  }

  // --- Approve/Reject mutation ---
  const approveRejectMutation = useApiMutation({
    method: 'PATCH',
    invalidateKeys: ['/api/attendance/corrections?type=pending', '/api/attendance/corrections?type=my'],
    onSuccess: (data) => {
      toast.success(`Correction processed successfully`)
      // Also refresh attendance data
      mutateTodayAttendance()
      mutateAttendance()
    },
    onError: (msg) => toast.error(msg || 'Failed to process correction'),
  })

  const handleApproveReject = async (correctionId, action, comments = '') => {
    await approveRejectMutation.execute('/api/attendance/corrections', {
      correctionId,
      action,
      reviewerComments: comments
    })
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

  const openCorrectionModal = (record, calendarDate = null) => {
    setSelectedRecord(record)
    // Use the calendar date if provided (more accurate for timezone handling)
    // Otherwise fall back to record.date
    const dateToUse = calendarDate || record.date
    setSelectedDayForEdit(dateToUse)
    setCorrectionForm({
      correctionType: 'both',
      requestedCheckIn: formatTimeForInput(record.checkIn),
      requestedCheckOut: formatTimeForInput(record.checkOut),
      requestedStatus: record.status,
      reason: ''
    })
    setShowCorrectionModal(true)
  }

  // Calendar navigation
  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
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
    // Keep the most recent record for each date (array is sorted desc by date)
    const attendanceMap = {}
    attendance.forEach(record => {
      const recordDate = new Date(record.date)
      const dateKey = getLocalDateKey(recordDate)
      // Only set if not already set (first occurrence = most recent due to desc sort)
      if (!attendanceMap[dateKey]) {
        attendanceMap[dateKey] = record
      }
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
    if (isFuture) return 'bg-default-50'
    if (!record) return 'bg-default-100/80' // No record - potentially absent
    switch (record.status) {
      case 'present': return 'bg-success-100/70'
      case 'in-progress': return 'bg-warning-100/70'
      case 'half-day': return 'bg-warning-100/70'
      case 'late': return 'bg-warning-100/70'
      case 'absent': return 'bg-danger-100/70'
      case 'on-leave': return 'bg-primary-100/70'
      case 'holiday': return 'bg-secondary-100/70'
      default: return 'bg-default-100/70'
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

  const getStatusBadgeColor = (status) => {
    switch (status) {
      case 'present': return 'bg-success-100 text-success-800 border-success-200'
      case 'in-progress': return 'bg-warning-100 text-warning-800 border-warning-200'
      case 'half-day': return 'bg-warning-100 text-warning-800 border-warning-200'
      case 'late': return 'bg-warning-100 text-warning-800 border-warning-200'
      case 'absent': return 'bg-danger-100 text-danger-800 border-danger-200'
      case 'on-leave': case 'leave': return 'bg-primary-100 text-primary-800 border-primary-200'
      case 'holiday': return 'bg-secondary-100 text-secondary-800 border-secondary-200'
      default: return 'bg-default-100 text-default-800 border-default-200'
    }
  }

  const openDayEditModal = (dayData) => {
    if (dayData.isFuture) return
    if (dayData.record) {
      // Pass dayData.date for accurate timezone handling
      openCorrectionModal(dayData.record, dayData.date)
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
    if (!user || loading) return
    setLoading(true)

    // Optimistic update: immediately show checked-in state in SWR cache
    const previousData = todayAttendanceRes
    const optimisticRecord = {
      ...(todayAttendance || {}),
      checkIn: new Date().toISOString(),
      status: 'in-progress',
    }
    mutateTodayAttendance(
      { ...todayAttendanceRes, data: [optimisticRecord] },
      false // don't revalidate yet
    )

    try {
      // Capture location with high accuracy - preferred but not blocking
      let locationData = null

      try {
        locationData = await captureLocation()
      } catch (locationError) {
        console.warn('Location capture failed:', locationError.message)
        // Show warning but continue with check-in
        toast.warning('Location could not be captured. Check-in will proceed without location.')
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
          latitude: locationData?.latitude || null,
          longitude: locationData?.longitude || null,
          accuracy: locationData?.accuracy || null,
          // Address will be resolved server-side for accuracy
        }),
      })

      const data = await response.json()

      if (data.success) {
        const address = data.data?.location?.checkIn?.address || 'Location captured'
        toast.success(`Clocked in successfully\n📍 ${address}`, { duration: 4000 })
        // Replace optimistic data with real server data, then revalidate
        mutateTodayAttendance({ ...todayAttendanceRes, data: [data.data] }, true)
        mutateAttendance()
      } else {
        // Rollback optimistic update
        mutateTodayAttendance(previousData, false)
        if (data.requiresLocation) {
          toast.error('Location is required for attendance. Please enable location services.')
        } else {
          toast.error(data.message || 'Failed to clock in')
        }
      }
    } catch (error) {
      console.error('Clock in error:', error)
      // Rollback optimistic update
      mutateTodayAttendance(previousData, false)
      toast.error('An error occurred while clocking in')
    } finally {
      setLoading(false)
    }
  }

  const handleClockOut = async () => {
    if (!user || loading) return
    setLoading(true)

    // Optimistic update: immediately show checked-out state in SWR cache
    const previousData = todayAttendanceRes
    const now = new Date()
    const checkInTime = todayAttendance?.checkIn ? new Date(todayAttendance.checkIn) : now
    const workHours = Math.round(((now - checkInTime) / (1000 * 60 * 60)) * 100) / 100
    const optimisticRecord = {
      ...(todayAttendance || {}),
      checkOut: now.toISOString(),
      status: 'present',
      workHours,
    }
    mutateTodayAttendance(
      { ...todayAttendanceRes, data: [optimisticRecord] },
      false // don't revalidate yet
    )

    try {
      // Capture location with high accuracy - preferred but not blocking
      let locationData = null

      try {
        locationData = await captureLocation()
      } catch (locationError) {
        console.warn('Location capture failed:', locationError.message)
        // Show warning but continue with check-out
        toast.warning('Location could not be captured. Check-out will proceed without location.')
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
          latitude: locationData?.latitude || null,
          longitude: locationData?.longitude || null,
          accuracy: locationData?.accuracy || null,
          // Address will be resolved server-side for accuracy
        }),
      })

      const data = await response.json()

      if (data.success) {
        const address = data.data?.location?.checkOut?.address || 'Location captured'
        toast.success(`Clocked out successfully\n📍 ${address}`, { duration: 4000 })
        // Replace optimistic data with real server data, then revalidate
        mutateTodayAttendance({ ...todayAttendanceRes, data: [data.data] }, true)
        mutateAttendance()
      } else {
        // Rollback optimistic update
        mutateTodayAttendance(previousData, false)
        if (data.requiresLocation) {
          toast.error('Location is required for attendance. Please enable location services.')
        } else {
          toast.error(data.message || 'Failed to clock out')
        }
      }
    } catch (error) {
      console.error('Clock out error:', error)
      // Rollback optimistic update
      mutateTodayAttendance(previousData, false)
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

  // Calculate dynamic status based on work hours
  // This ensures the displayed status reflects actual work time
  const calculateDynamicStatus = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return null

    const checkInTime = new Date(checkIn)
    const checkOutTime = new Date(checkOut)

    // Handle overnight shifts (checkout next day)
    let workHours = (checkOutTime - checkInTime) / (1000 * 60 * 60)
    if (workHours < 0) {
      // Checkout is next day
      workHours += 24
    }

    // Status thresholds (90% of 8h = 7.2h for present, 50% of 8h = 4h for half-day)
    const fullDayThreshold = 7.2
    const halfDayThreshold = 4

    if (workHours >= fullDayThreshold) return 'present'
    if (workHours >= halfDayThreshold) return 'half-day'
    return 'absent'
  }

  // Get work hours from check-in/check-out
  const calculateWorkHours = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return 0

    const checkInTime = new Date(checkIn)
    const checkOutTime = new Date(checkOut)

    let workHours = (checkOutTime - checkInTime) / (1000 * 60 * 60)
    if (workHours < 0) {
      workHours += 24 // Handle overnight shifts
    }

    return workHours
  }

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="page-container">
        <div className="space-y-4">
          <Skeleton className="h-10 w-1/4 rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Attendance</h1>
          <p className="text-sm sm:text-base text-default-500 mt-1">Track your attendance and work hours</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            color="warning"
            onPress={() => setShowMissingEntryModal(true)}
            startContent={<FaPlus className="w-3 h-3 sm:w-4 sm:h-4" />}
            className="text-sm sm:text-base"
          >
            <span className="hidden sm:inline">Report Missing Entry</span>
            <span className="sm:hidden">Missing Entry</span>
          </Button>
          <Button
            color="primary"
            onPress={() => setShowMyCorrections(!showMyCorrections)}
            startContent={<FaEdit className="w-3 h-3 sm:w-4 sm:h-4" />}
            className="text-sm sm:text-base"
          >
            <span className="hidden sm:inline">My Requests ({myCorrections.length})</span>
            <span className="sm:hidden">Requests ({myCorrections.length})</span>
          </Button>
          {canApprove && pendingCorrections.length > 0 && (
            <Button
              color="secondary"
              onPress={() => setShowPendingApprovals(!showPendingApprovals)}
              startContent={<FaExclamationCircle className="w-3 h-3 sm:w-4 sm:h-4" />}
              className="text-sm sm:text-base"
            >
              <span className="hidden sm:inline">Pending Approvals ({pendingCorrections.length})</span>
              <span className="sm:hidden">Approvals ({pendingCorrections.length})</span>
            </Button>
          )}
        </div>
      </div>

      {/* Pending Approvals Section (for admins/HRs/dept heads) */}
      {showPendingApprovals && pendingCorrections.length > 0 && (
        <Card className="mb-4 sm:mb-6 border border-secondary-200 bg-secondary-50">
          <CardHeader className="pb-2">
            <h2 className="text-lg sm:text-xl font-semibold text-secondary-800">Pending Correction Approvals</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {pendingCorrections.map((correction) => {
              // Calculate what status WOULD BE if approved
              const requestedCheckIn = correction.requestedCheckIn || correction.currentCheckIn
              const requestedCheckOut = correction.requestedCheckOut || correction.currentCheckOut
              const expectedStatus = requestedCheckIn && requestedCheckOut
                ? calculateDynamicStatus(requestedCheckIn, requestedCheckOut)
                : correction.requestedStatus || correction.currentStatus
              const expectedWorkHours = requestedCheckIn && requestedCheckOut
                ? calculateWorkHours(requestedCheckIn, requestedCheckOut)
                : 0

              return (
                <Card key={correction._id} className="border border-secondary-100">
                  <CardBody>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                      <div className="flex-1">
                        <p className="font-semibold text-sm sm:text-base text-default-800">
                          {correction.employee?.firstName} {correction.employee?.lastName}
                        </p>
                        <p className="text-xs sm:text-sm text-default-600 mt-1">
                          Date: {formatDate(correction.date)} | Type: {correction.correctionType}
                        </p>
                        <p className="text-xs sm:text-sm text-default-500 mt-1">
                          <strong>Current:</strong> {formatTime(correction.currentCheckIn)} - {formatTime(correction.currentCheckOut)} ({correction.currentStatus})
                        </p>
                        <p className="text-xs sm:text-sm text-primary mt-1">
                          <strong>Requested:</strong> {correction.requestedCheckIn ? formatTime(correction.requestedCheckIn) : formatTime(correction.currentCheckIn)} - {correction.requestedCheckOut ? formatTime(correction.requestedCheckOut) : formatTime(correction.currentCheckOut)}
                        </p>
                        {expectedWorkHours > 0 && (
                          <div className="text-xs sm:text-sm text-success mt-1 font-medium flex items-center gap-1 flex-wrap">
                            <strong>If approved:</strong> {expectedWorkHours.toFixed(1)}h worked → <Chip size="sm" color={expectedStatus === 'present' ? 'success' : expectedStatus === 'half-day' ? 'warning' : 'danger'}>{expectedStatus}</Chip>
                          </div>
                        )}
                        <p className="text-xs sm:text-sm text-default-600 mt-2 italic line-clamp-2">&quot;{correction.reason}&quot;</p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          isIconOnly
                          color="success"
                          size="sm"
                          onPress={() => handleApproveReject(correction._id, 'approve')}
                          title="Approve"
                        >
                          <FaCheck className="w-4 h-4" />
                        </Button>
                        <Button
                          isIconOnly
                          color="danger"
                          size="sm"
                          onPress={() => {
                            const comment = prompt('Reason for rejection (optional):')
                            handleApproveReject(correction._id, 'reject', comment || '')
                          }}
                          title="Reject"
                        >
                          <FaTimes className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )
            })}
          </CardBody>
        </Card>
      )}

      {/* My Correction Requests */}
      {showMyCorrections && (
        <Card className="mb-4 sm:mb-6 border border-primary-200 bg-primary-50">
          <CardHeader className="pb-2">
            <h2 className="text-lg sm:text-xl font-semibold text-primary-800">My Correction Requests</h2>
          </CardHeader>
          <CardBody>
            {myCorrections.length === 0 ? (
              <p className="text-sm sm:text-base text-default-500">No correction requests submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {myCorrections.map((correction) => (
                  <Card key={correction._id} className="border border-primary-100">
                    <CardBody>
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
                        <div className="flex-1">
                          <p className="font-medium text-sm sm:text-base text-default-800">{formatDate(correction.date)}</p>
                          <p className="text-xs sm:text-sm text-default-600">Type: {correction.correctionType}</p>
                          <p className="text-xs sm:text-sm text-default-500 italic line-clamp-2">&quot;{correction.reason}&quot;</p>
                        </div>
                        <Chip
                          size="sm"
                          color={correction.status === 'pending' ? 'warning' : correction.status === 'approved' ? 'success' : 'danger'}
                          variant="flat"
                        >
                          {correction.status}
                        </Chip>
                      </div>
                      {correction.reviewerComments && (
                        <p className="text-xs sm:text-sm text-default-500 mt-2">
                          <strong>Reviewer:</strong> {correction.reviewerComments}
                        </p>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Clock In/Out Card */}
      <Card className="mb-4 sm:mb-6 shadow-md">
        <CardBody>
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="w-full lg:w-auto">
              <h2 className="text-lg sm:text-xl font-semibold text-default-800 mb-3">Today&apos;s Attendance</h2>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 text-sm sm:text-base text-default-600">
                <div className="flex items-center gap-2">
                  <FaClock className="text-primary w-4 h-4" />
                  <span>Check In: {formatTime(todayAttendance?.checkIn)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FaClock className="text-primary w-4 h-4" />
                  <span>Check Out: {formatTime(todayAttendance?.checkOut)}</span>
                </div>
                {todayAttendance?.workHours && (
                  <div className="flex items-center gap-2">
                    <FaClock className="text-success w-4 h-4" />
                    <span className="font-semibold">
                      Work Hours: {todayAttendance.workHours}h
                    </span>
                  </div>
                )}
              </div>
              {/* Location Display */}
              {(todayAttendance?.location?.checkIn?.address || todayAttendance?.location?.checkOut?.address) && (
                <div className="mt-3 pt-3 border-t border-divider">
                  <div className="flex flex-col gap-2 text-xs sm:text-sm">
                    {todayAttendance?.location?.checkIn?.address && (
                      <div className="flex items-start gap-2 text-default-600">
                        <FaMapMarkerAlt className="text-success w-3 h-3 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-default-700">Check-in: </span>
                          <span className="text-default-600">{todayAttendance.location.checkIn.address}</span>
                        </div>
                      </div>
                    )}
                    {todayAttendance?.location?.checkOut?.address && (
                      <div className="flex items-start gap-2 text-default-600">
                        <FaMapMarkerAlt className="text-danger w-3 h-3 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium text-default-700">Check-out: </span>
                          <span className="text-default-600">{todayAttendance.location.checkOut.address}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <Button
                color="primary"
                size="lg"
                onPress={handleClockIn}
                isDisabled={loading || locationLoading || (todayAttendance && todayAttendance.checkIn)}
                startContent={<FaSignInAlt className="w-4 h-4 sm:w-5 sm:h-5" />}
                className="font-semibold"
              >
                {loading || locationLoading ? 'Getting Location...' : 'Clock In'}
              </Button>
              <Button
                color="secondary"
                size="lg"
                onPress={handleClockOut}
                isDisabled={loading || locationLoading || !todayAttendance || !todayAttendance.checkIn || todayAttendance.checkOut}
                startContent={<FaSignOutAlt className="w-4 h-4 sm:w-5 sm:h-5" />}
                className="font-semibold"
              >
                {loading || locationLoading ? 'Getting Location...' : 'Clock Out'}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Attendance History - Calendar & List View */}
      <Card className="shadow-md">
        <CardBody>
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 sm:mb-6 gap-3 sm:gap-4">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-default-800">My Attendance - {user?.firstName} {user?.lastName}</h2>
              <p className="text-xs sm:text-sm text-default-500 mt-1">Click on any day to edit or report missing entry</p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto">
              {/* View Toggle */}
              <div className="flex bg-default-100 rounded-lg p-1 w-full sm:w-auto">
                <Button
                  size="sm"
                  variant={viewMode === 'calendar' ? 'solid' : 'light'}
                  onPress={() => setViewMode('calendar')}
                  startContent={<FaTh className="w-3 h-3 sm:w-4 sm:h-4" />}
                  className="flex-1 sm:flex-initial"
                >
                  Calendar
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'list' ? 'solid' : 'light'}
                  onPress={() => setViewMode('list')}
                  startContent={<FaList className="w-3 h-3 sm:w-4 sm:h-4" />}
                  className="flex-1 sm:flex-initial"
                >
                  List
                </Button>
              </div>

              {/* Month Navigation */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  onPress={goToPreviousMonth}
                >
                  <FaChevronLeft className="w-3 h-3 sm:w-4 sm:h-4" />
                </Button>
                <span className="text-sm sm:text-lg font-medium text-default-800 min-w-[120px] sm:min-w-[140px] text-center">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  onPress={goToNextMonth}
                >
                  <FaChevronRight className="w-3 h-3 sm:w-4 sm:h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Status Legend */}
          <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 sm:mb-6 p-2 sm:p-3 bg-default-50 rounded-lg">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-success-100 border border-success-400"></div>
              <span className="text-[10px] sm:text-xs text-default-600">Present</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-warning-100 border border-warning-400"></div>
              <span className="text-[10px] sm:text-xs text-default-600">In Progress</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-warning-100 border border-warning-400"></div>
              <span className="text-[10px] sm:text-xs text-default-600">Half Day</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-warning-100 border border-warning-400"></div>
              <span className="text-[10px] sm:text-xs text-default-600">Late</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-danger-100 border border-danger-400"></div>
              <span className="text-[10px] sm:text-xs text-default-600">Absent</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-primary-100 border border-primary-400"></div>
              <span className="text-[10px] sm:text-xs text-default-600">On Leave</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-secondary-100 border border-secondary-400"></div>
              <span className="text-[10px] sm:text-xs text-default-600">Holiday</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-3 h-3 sm:w-4 sm:h-4 rounded bg-default-100 border border-default-300"></div>
              <span className="text-[10px] sm:text-xs text-default-600">No Record</span>
            </div>
          </div>

          {viewMode === 'calendar' ? (
            /* Calendar View */
            <div className="overflow-x-auto overflow-y-visible">
              <div className="min-w-[700px] p-2">
                {/* Day Headers */}
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="text-center text-xs sm:text-sm font-semibold text-default-500 py-2">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1">
                  {calendarData.map((dayData, index) => {
                    const pendingCorrection = dayData.day ? getPendingCorrectionForDay(dayData) : null
                    const hasPending = !!pendingCorrection
                    // Use company working days setting (0=Sunday, 6=Saturday)
                    const dayOfWeek = dayData.date ? dayData.date.getDay() : null
                    const isWorkingDay = dayOfWeek !== null ? workingDays.includes(dayOfWeek) : false
                    const isWeekend = !isWorkingDay
                    const isHoliday = dayData.record?.status === 'holiday' || dayData.holiday
                    const holidayName = dayData.holiday?.name || (dayData.record?.status === 'holiday' ? 'Holiday' : '')

                    // Check if this is a past working day without a record (should show as absent)
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    const dayDate = dayData.date ? new Date(dayData.date) : null
                    if (dayDate) dayDate.setHours(0, 0, 0, 0)
                    const isPastDay = dayDate && dayDate < today
                    const isAfterJoining = !employeeJoiningDate || (dayDate && dayDate >= employeeJoiningDate)
                    const shouldShowAsAbsent = dayData.isCurrentMonth && isPastDay && isWorkingDay && !isHoliday && !dayData.record && isAfterJoining

                    // Determine status color
                    let statusColor = 'bg-default-50'
                    let displayStatus = dayData.record?.status

                    if (dayData.record) {
                      if (dayData.record.status === 'present') statusColor = 'bg-success-50 border-success-100'
                      else if (dayData.record.status === 'absent') statusColor = 'bg-danger-50 border-danger-100'
                      else if (dayData.record.status === 'late') statusColor = 'bg-warning-50 border-warning-100'
                      else if (dayData.record.status === 'half-day') statusColor = 'bg-warning-50 border-warning-100'
                      else if (dayData.record.status === 'leave') statusColor = 'bg-primary-50 border-primary-100'
                      else if (dayData.record.status === 'holiday') statusColor = 'bg-secondary-50 border-secondary-100'
                    } else if (isHoliday) {
                      statusColor = 'bg-secondary-50 border-secondary-100'
                    } else if (shouldShowAsAbsent) {
                      // Past working day without record = show as absent
                      statusColor = 'bg-danger-50 border-danger-200'
                      displayStatus = 'absent'
                    }

                    return (
                      <div
                        key={index}
                        onClick={() => {
                          if (dayData.holiday) {
                            setSelectedHoliday(dayData.holiday)
                            setShowHolidayModal(true)
                          } else if (dayData.record) {
                            // Open correction modal to view/edit the attendance record
                            // Pass dayData.date for accurate timezone handling
                            openCorrectionModal(dayData.record, dayData.date)
                          } else if (dayData.isCurrentMonth && !isWeekend && !isHoliday && new Date(dayData.date) < new Date()) {
                            // Handle missing entry click - use local date to avoid UTC offset issues
                            const d = dayData.date
                            const localDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                            setSelectedDayForMissingEntry(d)
                            setMissingEntryForm({
                              date: localDateStr,
                              checkIn: '',
                              checkOut: '',
                              reason: ''
                            })
                            setShowMissingEntryModal(true)
                          }
                        }}
                        className={`
                      min-h-[80px] sm:min-h-[120px] p-1.5 sm:p-2 border rounded transition-all cursor-pointer relative group
                      ${statusColor}
                      ${dayData.isToday ? 'ring-2 ring-primary' : ''}
                      ${!dayData.isCurrentMonth ? 'opacity-40 bg-default-50 border-transparent' : 'bg-content1 hover:shadow'}
                    `}
                      >
                        {/* Day number */}
                        <div className="font-bold text-xs sm:text-sm mb-1">
                          <span className={dayData.isToday ? 'text-primary' : 'text-default-700'}>
                            {dayData.day}
                          </span>
                        </div>

                        {/* Status badge - show for records OR for computed absent status */}
                        {(dayData.record?.status || displayStatus) && (
                          <div className="mb-1">
                            <span className={`
                          inline-block text-[9px] sm:text-[10px] px-1 py-0.5 rounded border font-medium uppercase tracking-tight leading-tight
                          ${getStatusBadgeColor(displayStatus || dayData.record?.status)}
                          break-words max-w-full
                        `} style={{ wordBreak: 'break-word', hyphens: 'auto' }}>
                              {displayStatus || dayData.record?.status}
                            </span>
                          </div>
                        )}

                        {/* Edit button for regularisation - show on hover */}
                        {dayData.isCurrentMonth && dayData.record && !isHoliday && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              // Pass dayData.date for accurate timezone handling
                              openCorrectionModal(dayData.record, dayData.date)
                            }}
                            className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 p-0.5 sm:p-1 rounded-full bg-content1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary-50 z-10"
                            title="Request Regularisation"
                          >
                            <FaEdit className="w-2 h-2 sm:w-3 sm:h-3 text-primary" />
                          </button>
                        )}

                        {/* Pending correction indicator */}
                        {hasPending && (
                          <div className="absolute bottom-0.5 sm:bottom-1 right-0.5 sm:right-1">
                            <span className="text-[7px] sm:text-[8px] px-0.5 sm:px-1 py-0.5 bg-warning text-warning-foreground rounded font-medium">
                              Pending
                            </span>
                          </div>
                        )}

                        {/* Add button for missing entry - show on hover for past working dates without records */}
                        {shouldShowAsAbsent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              const d = dayData.date
                              const localDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                              setSelectedDayForMissingEntry(d)
                              setMissingEntryForm({
                                date: localDateStr,
                                checkIn: '',
                                checkOut: '',
                                reason: ''
                              })
                              setShowMissingEntryModal(true)
                            }}
                            className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 p-0.5 sm:p-1 rounded-full bg-content1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-success-50 z-10"
                            title="Add Missing Entry"
                          >
                            <FaPlus className="w-2 h-2 sm:w-3 sm:h-3 text-success" />
                          </button>
                        )}

                        {/* Holiday Name */}
                        {isHoliday && (
                          <div className="text-[9px] sm:text-[10px] leading-tight text-secondary-700 mt-1 font-medium bg-secondary-100/50 px-1 py-0.5 rounded break-words" style={{ wordBreak: 'break-word', hyphens: 'auto' }}>
                            {holidayName}
                          </div>
                        )}

                        {/* Time details for present/late/half-day */}
                        {dayData.record && ['present', 'late', 'half-day'].includes(dayData.record.status) && (
                          <div className="text-[9px] sm:text-[10px] text-default-600 mt-1 space-y-0.5 max-h-[50px] sm:max-h-[70px] overflow-y-auto overflow-x-hidden">
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
                <thead className="bg-default-50 border-b border-divider">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Check In</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Check Out</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider hidden md:table-cell">Locations</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Hours</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-content1 divide-y divide-divider">
                  {attendance.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-4 py-4 text-center text-default-500">
                        No attendance records found for this month
                      </td>
                    </tr>
                  ) : (
                    attendance.map((record) => {
                      const pendingCorrection = getPendingCorrectionForRecord(record)
                      const hasPending = !!pendingCorrection

                      return (
                        <tr key={record._id} className={`hover:bg-default-50 ${hasPending ? 'bg-warning-50' : ''}`}>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-default-900">{formatDate(record.date)}</td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-default-900">{formatTime(record.checkIn)}</td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-default-900">{formatTime(record.checkOut)}</td>
                          <td className="px-4 py-4 text-xs text-default-600 hidden md:table-cell max-w-xs">
                            {record.location?.checkIn?.address || record.location?.checkOut?.address ? (
                              <div className="space-y-1">
                                {record.location?.checkIn?.address && (
                                  <div className="flex items-start gap-1">
                                    <FaMapMarkerAlt className="text-success mt-0.5 flex-shrink-0 w-3 h-3" />
                                    <span className="truncate" title={record.location.checkIn.address}>
                                      {record.location.checkIn.address.length > 40
                                        ? record.location.checkIn.address.substring(0, 40) + '...'
                                        : record.location.checkIn.address}
                                    </span>
                                  </div>
                                )}
                                {record.location?.checkOut?.address && (
                                  <div className="flex items-start gap-1">
                                    <FaMapMarkerAlt className="text-danger mt-0.5 flex-shrink-0 w-3 h-3" />
                                    <span className="truncate" title={record.location.checkOut.address}>
                                      {record.location.checkOut.address.length > 40
                                        ? record.location.checkOut.address.substring(0, 40) + '...'
                                        : record.location.checkOut.address}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-default-400 italic">Not captured</span>
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-default-900">{record.workHours ? `${record.workHours}h` : 'N/A'}</td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <Chip
                              size="sm"
                              color={record.status === 'present' ? 'success' :
                                record.status === 'absent' ? 'danger' :
                                  record.status === 'half-day' ? 'warning' :
                                    record.status === 'in-progress' ? 'warning' :
                                      record.status === 'late' ? 'warning' :
                                        record.status === 'on-leave' ? 'primary' :
                                          'default'}
                              variant="flat"
                            >
                              {record.status === 'in-progress' ? 'In Progress' : record.status}
                            </Chip>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            {hasPending ? (
                              <Chip size="sm" color="warning" variant="bordered" startContent={<FaClock className="w-3 h-3" />}>
                                Pending
                              </Chip>
                            ) : (
                              <Button
                                size="sm"
                                variant="light"
                                color="primary"
                                onPress={() => {
                                  // Extract date in local timezone from the record
                                  const recordDate = new Date(record.date)
                                  const localDate = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate())
                                  openCorrectionModal(record, localDate)
                                }}
                                startContent={<FaEdit />}
                              >
                                Correct
                              </Button>
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
          <div className="mt-6 pt-6 border-t border-divider">
            <h3 className="text-lg font-semibold text-default-800 mb-4">Monthly Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-success-50">
                <CardBody className="text-center py-4">
                  <p className="text-2xl font-bold text-success">
                    {attendance.filter(r => r.status === 'present').length}
                  </p>
                  <p className="text-sm text-success-700">Present Days</p>
                </CardBody>
              </Card>
              <Card className="bg-danger-50">
                <CardBody className="text-center py-4">
                  <p className="text-2xl font-bold text-danger">
                    {attendance.filter(r => r.status === 'absent').length}
                  </p>
                  <p className="text-sm text-danger-700">Absent Days</p>
                </CardBody>
              </Card>
              <Card className="bg-warning-50">
                <CardBody className="text-center py-4">
                  <p className="text-2xl font-bold text-warning">
                    {attendance.filter(r => r.status === 'late').length}
                  </p>
                  <p className="text-sm text-warning-700">Late Days</p>
                </CardBody>
              </Card>
              <Card className="bg-warning-50">
                <CardBody className="text-center py-4">
                  <p className="text-2xl font-bold text-warning">
                    {attendance.filter(r => r.status === 'half-day').length}
                  </p>
                  <p className="text-sm text-warning-700">Half Days</p>
                </CardBody>
              </Card>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Correction Request Modal */}
      <Modal
        isOpen={showCorrectionModal && selectedRecord}
        onClose={() => { setShowCorrectionModal(false); setSelectedRecord(null); setSelectedDayForEdit(null); }}
        size="lg"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            Request Attendance Correction
          </ModalHeader>
          <ModalBody>
            {/* Display the date from selectedRecord - not editable */}
            <Card className="bg-primary-50 border border-primary-200">
              <CardBody className="py-3">
                <p className="text-sm font-medium text-primary-800">
                  <FaCalendarAlt className="inline mr-2" />
                  Date: {selectedDayForEdit
                    ? selectedDayForEdit.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : selectedRecord && formatDate(selectedRecord.date)}
                </p>
                {(() => {
                  // Dynamically calculate status based on actual work hours
                  const dynamicStatus = selectedRecord?.checkIn && selectedRecord?.checkOut
                    ? calculateDynamicStatus(selectedRecord.checkIn, selectedRecord.checkOut)
                    : selectedRecord?.status
                  const workHours = selectedRecord?.checkIn && selectedRecord?.checkOut
                    ? calculateWorkHours(selectedRecord.checkIn, selectedRecord.checkOut)
                    : selectedRecord?.workHours || 0
                  const storedStatus = selectedRecord?.status
                  const statusMismatch = dynamicStatus && storedStatus && dynamicStatus !== storedStatus

                  return (
                    <>
                      <p className="text-xs text-primary mt-1">
                        Current: {selectedRecord && formatTime(selectedRecord.checkIn)} - {selectedRecord && formatTime(selectedRecord.checkOut)}
                        <span className={`ml-1 ${statusMismatch ? 'text-warning font-medium' : ''}`}>
                          ({dynamicStatus || storedStatus || 'N/A'})
                        </span>
                        {workHours > 0 && (
                          <span className="ml-1 text-default-500">• {workHours.toFixed(1)}h worked</span>
                        )}
                      </p>
                      {statusMismatch && (
                        <p className="text-xs text-warning mt-1 bg-warning-50 rounded px-2 py-1">
                          ⚠️ Stored status "{storedStatus}" differs from calculated "{dynamicStatus}" - correction may fix this
                        </p>
                      )}
                    </>
                  )
                })()}
                {/* Location Display in Modal */}
                {(selectedRecord?.location?.checkIn?.address || selectedRecord?.location?.checkOut?.address) && (
                  <div className="mt-2 pt-2 border-t border-primary-200">
                    {selectedRecord?.location?.checkIn?.address && (
                      <p className="text-xs text-primary flex items-start gap-1">
                        <FaMapMarkerAlt className="text-success mt-0.5 flex-shrink-0" />
                        <span><strong>Check-in:</strong> {selectedRecord.location.checkIn.address}</span>
                      </p>
                    )}
                    {selectedRecord?.location?.checkOut?.address && (
                      <p className="text-xs text-primary flex items-start gap-1 mt-1">
                        <FaMapMarkerAlt className="text-danger mt-0.5 flex-shrink-0" />
                        <span><strong>Check-out:</strong> {selectedRecord.location.checkOut.address}</span>
                      </p>
                    )}
                  </div>
                )}
                {/* Show "Location not captured" for old records */}
                {selectedRecord && !selectedRecord?.location?.checkIn?.address && !selectedRecord?.location?.checkOut?.address && (
                  <p className="text-xs text-default-500 mt-2 pt-2 border-t border-primary-200 flex items-center gap-1">
                    <FaMapMarkerAlt className="text-default-400" />
                    <span>Location not captured</span>
                  </p>
                )}
              </CardBody>
            </Card>

            <div className="space-y-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-default-700 mb-1">Correction Type</label>
                <Select
                  selectedKeys={[correctionForm.correctionType]}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, correctionType: e.target.value })}
                  aria-label="Correction Type"
                  classNames={{ trigger: "bg-white dark:bg-slate-900" }}
                >
                  <SelectItem key="check-in">Check-In Time</SelectItem>
                  <SelectItem key="check-out">Check-Out Time</SelectItem>
                  <SelectItem key="both">Both Times</SelectItem>
                  <SelectItem key="status">Status Only</SelectItem>
                </Select>
              </div>

              {['check-in', 'both'].includes(correctionForm.correctionType) && (
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-1">Correct Check-In Time</label>
                  <input
                    type="time"
                    value={correctionForm.requestedCheckIn}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, requestedCheckIn: e.target.value })}
                    className="w-full px-3 py-2 border border-default-300 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {['check-out', 'both'].includes(correctionForm.correctionType) && (
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-1">Correct Check-Out Time</label>
                  <input
                    type="time"
                    value={correctionForm.requestedCheckOut}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, requestedCheckOut: e.target.value })}
                    className="w-full px-3 py-2 border border-default-300 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {correctionForm.correctionType === 'status' && (
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-1">Requested Status</label>
                  <Select
                    selectedKeys={correctionForm.requestedStatus ? [correctionForm.requestedStatus] : []}
                    onChange={(e) => setCorrectionForm({ ...correctionForm, requestedStatus: e.target.value })}
                    aria-label="Requested Status"
                    classNames={{ trigger: "bg-white dark:bg-slate-900" }}
                  >
                    <SelectItem key="present">Present</SelectItem>
                    <SelectItem key="half-day">Half Day</SelectItem>
                    <SelectItem key="on-leave">On Leave</SelectItem>
                  </Select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-default-700 mb-1">Reason for Correction *</label>
                <textarea
                  value={correctionForm.reason}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })}
                  placeholder="Please explain why this correction is needed..."
                  rows={3}
                  className="w-full px-3 py-2 border border-default-300 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="default"
              variant="flat"
              onPress={() => {
                setShowCorrectionModal(false)
                setSelectedRecord(null)
                setSelectedDayForEdit(null)
              }}
            >
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleCorrectionRequest}
              isDisabled={correctionMutation.isLoading || !correctionForm.reason}
              isLoading={correctionMutation.isLoading}
            >
              {correctionMutation.isLoading ? 'Submitting...' : 'Submit Request'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Missing Entry Modal */}
      <Modal
        isOpen={showMissingEntryModal}
        onClose={() => {
          setShowMissingEntryModal(false)
          setSelectedDayForMissingEntry(null)
          setMissingEntryForm({ date: '', checkIn: '', checkOut: '', reason: '' })
        }}
        size="lg"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            Report Missing Entry
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-default-500 mb-2">Submit a request to add attendance for a day you forgot to clock in/out.</p>

            <div className="space-y-4">
              {/* Show date as read-only info box when selected from calendar */}
              {selectedDayForMissingEntry ? (
                <Card className="bg-warning-50 border border-warning-200">
                  <CardBody className="py-3">
                    <p className="text-sm font-medium text-warning-800">
                      <FaCalendarAlt className="inline mr-2" />
                      Date: {formatDate(selectedDayForMissingEntry)}
                    </p>
                  </CardBody>
                </Card>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={missingEntryForm.date}
                    onChange={(e) => setMissingEntryForm({ ...missingEntryForm, date: e.target.value })}
                    max={formatDateLocal(new Date())}
                    className="w-full px-3 py-2 border border-default-300 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-default-700 mb-1">Check-In Time</label>
                <input
                  type="time"
                  value={missingEntryForm.checkIn}
                  onChange={(e) => setMissingEntryForm({ ...missingEntryForm, checkIn: e.target.value })}
                  className="w-full px-3 py-2 border border-default-300 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-default-700 mb-1">Check-Out Time</label>
                <input
                  type="time"
                  value={missingEntryForm.checkOut}
                  onChange={(e) => setMissingEntryForm({ ...missingEntryForm, checkOut: e.target.value })}
                  className="w-full px-3 py-2 border border-default-300 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-default-700 mb-1">Reason *</label>
                <textarea
                  value={missingEntryForm.reason}
                  onChange={(e) => setMissingEntryForm({ ...missingEntryForm, reason: e.target.value })}
                  placeholder="Why did you miss clocking in/out?"
                  rows={3}
                  className="w-full px-3 py-2 border border-default-300 rounded-lg bg-white dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="default"
              variant="flat"
              onPress={() => {
                setShowMissingEntryModal(false)
                setSelectedDayForMissingEntry(null)
                setMissingEntryForm({ date: '', checkIn: '', checkOut: '', reason: '' })
              }}
            >
              Cancel
            </Button>
            <Button
              color="warning"
              onPress={handleMissingEntryRequest}
              isDisabled={missingEntryMutation.isLoading || (!selectedDayForMissingEntry && !missingEntryForm.date) || !missingEntryForm.reason}
              isLoading={missingEntryMutation.isLoading}
            >
              {missingEntryMutation.isLoading ? 'Submitting...' : 'Submit Request'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

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
              mutateAttendance()
              mutateTodayAttendance()
            }
          }}
        />
      )}

      {/* Holiday Details Modal */}
      <Modal
        isOpen={showHolidayModal && selectedHoliday}
        onClose={() => setShowHolidayModal(false)}
        size="md"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            {selectedHoliday?.name}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Card className="bg-secondary-50 border border-secondary-100">
                <CardBody className="flex-row items-center gap-3">
                  <div className="bg-content1 p-2 rounded-full shadow-sm">
                    <FaCalendarAlt className="text-secondary" size={18} />
                  </div>
                  <div>
                    <p className="text-xs text-secondary font-semibold uppercase tracking-wide">Date</p>
                    <p className="text-default-800 font-medium">
                      {selectedHoliday && new Date(selectedHoliday.date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                  </div>
                </CardBody>
              </Card>

              {selectedHoliday?.description ? (
                <Card className="bg-default-50 border border-default-100">
                  <CardBody>
                    <h4 className="text-sm font-semibold text-default-700 mb-2">Description</h4>
                    <p className="text-default-600 text-sm leading-relaxed">
                      {selectedHoliday.description}
                    </p>
                  </CardBody>
                </Card>
              ) : (
                <div className="text-center py-4 text-default-500 italic bg-default-50 rounded-lg">
                  No description available for this holiday.
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Chip color="secondary" variant="flat" size="sm">
                  {selectedHoliday?.type || 'Public Holiday'}
                </Chip>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              color="default"
              variant="flat"
              onPress={() => setShowHolidayModal(false)}
            >
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

