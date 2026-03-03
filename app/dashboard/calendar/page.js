'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import {
  FaChevronLeft,
  FaChevronRight,
  FaBirthdayCake,
  FaCalendarAlt,
  FaBullhorn,
  FaList,
  FaTh
} from 'react-icons/fa'
import toast from '@/utils/toast'
import { Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [viewMode, setViewMode] = useState('calendar')
  const [loading, setLoading] = useState(true)

  const [holidays, setHolidays] = useState([])
  const [birthdays, setBirthdays] = useState([])
  const [announcements, setAnnouncements] = useState([])

  // Real-time updates
  const { socket, isConnected, subscribe, onHolidayUpdate, onAnnouncementUpdate } = useSocket()

  useEffect(() => {
    fetchAllData()
  }, [])

  // Subscribe to real-time calendar updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleUpdate = (data) => {
      console.log('🔄 [Calendar] Real-time update received:', data)
      fetchAllData()
    }

    const unsub1 = onHolidayUpdate?.(handleUpdate)
    const unsub2 = onAnnouncementUpdate?.(handleUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.HOLIDAY_UPDATE, handleUpdate)
    const unsub4 = subscribe?.(REALTIME_EVENTS.ANNOUNCEMENT_CREATED, handleUpdate)
    const unsub5 = subscribe?.(REALTIME_EVENTS.ANNOUNCEMENT_UPDATED, handleUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
      unsub3?.()
      unsub4?.()
      unsub5?.()
    }
  }, [socket, isConnected])

  // Auto-switch to list view on mobile
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])

  const fetchAllData = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const headers = { Authorization: `Bearer ${token}` }

      const [holidaysRes, birthdaysRes, announcementsRes] = await Promise.all([
        fetch('/api/holidays?limit=100', { headers }),
        fetch('/api/employees/birthdays', { headers }),
        fetch('/api/announcements?limit=100', { headers })
      ])

      const holidaysData = await holidaysRes.json()
      if (holidaysData.success) setHolidays(holidaysData.data)

      const birthdaysData = await birthdaysRes.json()
      if (birthdaysData.success && birthdaysData.data) {
        setBirthdays(
          birthdaysData.data.map(emp => ({
            ...emp,
            dateOfBirth: new Date(emp.dateOfBirth)
          }))
        )
      }

      const announcementsData = await announcementsRes.json()
      if (announcementsData.success) setAnnouncements(announcementsData.data)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load calendar data')
    } finally {
      setLoading(false)
    }
  }

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const calendarData = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay()

    const days = []

    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ day: null, events: [] })
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      const today = new Date()
      const isToday =
        date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear()

      const events = []

      holidays.forEach(h => {
        const d = new Date(h.date)
        if (d.getDate() === day && d.getMonth() === month && d.getFullYear() === year) {
          events.push({
            type: 'holiday',
            title: h.name,
            color: 'bg-purple-100 text-purple-800 border-purple-200'
          })
        }
      })

      birthdays.forEach(emp => {
        if (emp.dateOfBirth.getDate() === day && emp.dateOfBirth.getMonth() === month) {
          events.push({
            type: 'birthday',
            title: `${emp.firstName} ${emp.lastName}'s Birthday`,
            color: 'bg-pink-100 text-pink-800 border-pink-200'
          })
        }
      })

      announcements.forEach(a => {
        const d = new Date(a.createdAt)
        if (d.getDate() === day && d.getMonth() === month && d.getFullYear() === year) {
          events.push({
            type: 'announcement',
            title: a.title,
            color: 'bg-blue-100 text-blue-800 border-blue-200'
          })
        }
      })

      days.push({ day, date, isToday, events })
    }

    return days
  }, [currentMonth, holidays, birthdays, announcements])

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
          <div>
            <Skeleton className="h-7 w-56 rounded-lg mb-2" />
            <Skeleton className="h-4 w-72 rounded-lg" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-10 w-36 rounded-lg" />
            <Skeleton className="h-10 w-48 rounded-lg" />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <Skeleton key={i} className="h-5 w-full rounded" />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return <DataErrorState error={error} onRetry={refreshAll} title="Failed to load calendar data" />
  }

  return (
    <div className="p-4 sm:p-6">
      <BackgroundRefreshIndicator isValidating={isValidating} />
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">General Calendar</h1>
          <p className="text-gray-600 text-sm mt-1">
            View holidays, birthdays, and company events
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* View Toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            {['calendar', 'list'].map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1 ${viewMode === mode
                  ? 'bg-white shadow text-gray-800'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                {mode === 'calendar' ? <FaTh /> : <FaList />}
                {mode}
              </button>
            ))}
          </div>

          {/* Month Nav */}
          <div className="flex items-center bg-white border rounded-lg p-1">
            <button onClick={goToPreviousMonth} className="p-2 hover:bg-gray-100 rounded">
              <FaChevronLeft />
            </button>
            <span className="min-w-[120px] sm:min-w-[160px] text-center font-medium text-sm sm:text-lg truncate">
              {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={goToNextMonth} className="p-2 hover:bg-gray-100 rounded">
              <FaChevronRight />
            </button>
          </div>
        </div>
      </div>

      {/* Calendar */}
      {viewMode === 'calendar' ? (
        <div className="bg-white rounded-lg shadow-md p-2 sm:p-4 overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-7 gap-1 text-xs sm:text-sm border-b pb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center font-semibold text-gray-500">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1 mt-2">
              {calendarData.map((d, i) => (
                <div
                  key={i}
                  className={`min-h-[80px] sm:min-h-[120px] p-1.5 sm:p-2 rounded border ${d.day ? 'bg-white hover:shadow' : 'bg-gray-50 border-transparent'
                    } ${d.isToday ? 'ring-2 ring-primary-500' : ''}`}
                >
                  {d.day && (
                    <>
                      <div className="font-bold text-xs sm:text-sm mb-1">{d.day}</div>
                      <div className="space-y-1 max-h-[60px] sm:max-h-[80px] overflow-y-auto">
                        {d.events.map((e, j) => (
                          <div
                            key={j}
                            className={`text-[10px] sm:text-xs p-1 rounded border flex gap-1 items-center ${e.color}`}
                          >
                            {e.type === 'holiday' && <FaCalendarAlt />}
                            {e.type === 'birthday' && <FaBirthdayCake />}
                            {e.type === 'announcement' && <FaBullhorn />}
                            <span className="truncate">{e.title}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* List View */
        <div className="bg-white rounded-lg shadow-md divide-y">
          {calendarData
            .filter(d => d.day && d.events.length)
            .map((d, i) => (
              <div key={i} className="p-3 sm:p-4">
                <div className="font-bold text-gray-700 mb-2">
                  {d.date.toDateString()}
                </div>
                <div className="space-y-2">
                  {d.events.map((e, j) => (
                    <div key={j} className={`p-3 rounded border flex gap-3 ${e.color}`}>
                      {e.type === 'holiday' && <FaCalendarAlt />}
                      {e.type === 'birthday' && <FaBirthdayCake />}
                      {e.type === 'announcement' && <FaBullhorn />}
                      <span>{e.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
