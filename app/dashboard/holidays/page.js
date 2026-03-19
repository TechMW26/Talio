'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import {
  FaPlus, FaEdit, FaTrash, FaCalendarAlt,
  FaList, FaTh, FaChevronLeft, FaChevronRight
} from 'react-icons/fa'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Select, SelectItem, Input, Textarea, Checkbox, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths,
  parseISO, isToday
} from 'date-fns'

export default function HolidaysPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState(null)

  // View Mode State
  const [viewMode, setViewMode] = useState('calendar') // 'calendar' or 'list'
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const [formData, setFormData] = useState({
    name: '',
    date: '',
    type: 'public',
    description: '',
    locations: [],
    applicableTo: 'all'
  })

  const countries = [
    'India', 'USA', 'UK', 'Canada', 'Australia', 'UAE', 'Singapore', 'Germany', 'France', 'Japan'
  ]

  // --- SWR Data Fetching ---
  const { data: holidaysRes, error, isLoading, isValidating, mutate: refreshHolidays } = useAuthedSWR('/api/holidays')
  const holidays = holidaysRes?.data || []

  // Real-time updates
  const { socket, isConnected, subscribe, onHolidayUpdate } = useSocket()

  useEffect(() => {
    if (!socket || !isConnected) return

    const handleHolidayUpdate = (data) => {
      console.log('🔄 [Holidays] Real-time update received:', data)
      refreshHolidays()
    }

    const unsub1 = onHolidayUpdate?.(handleHolidayUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.HOLIDAY_UPDATE, handleHolidayUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
    }
  }, [socket, isConnected])

  // Auto-switch to list view on mobile
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])

  // --- Submit mutation (create/edit) ---
  const submitMutation = useApiMutation({
    invalidateKeys: ['/api/holidays'],
    onSuccess: (data) => {
      toast.success(data.message || 'Holiday saved')
      handleCloseModal()
    },
    onError: (msg) => toast.error(msg || 'Failed to save holiday'),
  })

  // --- Delete mutation ---
  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/holidays'],
    onSuccess: (data) => toast.success(data.message || 'Holiday deleted'),
    onError: (msg) => toast.error(msg || 'Failed to delete holiday'),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    const url = editingHoliday ? `/api/holidays/${editingHoliday._id}` : '/api/holidays'
    const method = editingHoliday ? 'PUT' : 'POST'
    const dataToSend = { ...formData, year: new Date(formData.date).getFullYear() }
    submitMutation.execute(url, dataToSend, { method })
  }

  const handleEdit = (holiday) => {
    setEditingHoliday(holiday)
    setFormData({
      name: holiday.name,
      date: new Date(holiday.date).toISOString().split('T')[0],
      type: holiday.type || 'public',
      description: holiday.description || '',
      locations: holiday.locations || [],
      applicableTo: holiday.applicableTo || 'all'
    })
    setShowModal(true)
  }

  const handleDelete = (id) => {
    if (!confirm('Are you sure you want to delete this holiday?')) return
    deleteMutation.execute(`/api/holidays/${id}`)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingHoliday(null)
    setFormData({
      name: '',
      date: '',
      type: 'public',
      description: '',
      locations: [],
      applicableTo: 'all'
    })
  }

  // Calendar Helpers
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1))
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1))
  const goToToday = () => setCurrentMonth(new Date())

  const getHolidayForDate = (date) => {
    return holidays.find(h => isSameDay(new Date(h.date), date))
  }

  const getHolidayColor = (type) => {
    switch (type) {
      case 'public': return 'bg-green-100 text-green-800 border-green-200'
      case 'company': return 'bg-blue-100 text-blue-800 border-blue-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const renderCalendar = () => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(monthStart)
    const startDate = startOfWeek(monthStart)
    const endDate = endOfWeek(monthEnd)
    const dateFormat = "d"
    const rows = []
    let days = []
    let day = startDate
    let formattedDate = ""

    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    // Render Cells
    const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate })

    return (
      <div className="bg-white rounded-lg shadow-md p-2 sm:p-4 overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Calendar Controls */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg sm:text-xl font-bold text-gray-800">
              {format(currentMonth, 'MMMM yyyy')}
            </h2>
            <div className="flex space-x-2">
              <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-full">
                <FaChevronLeft />
              </button>
              <button onClick={goToToday} className="px-2 sm:px-3 py-1 text-xs sm:text-sm bg-gray-100 hover:bg-gray-200 rounded-md">
                Today
              </button>
              <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-full">
                <FaChevronRight />
              </button>
            </div>
          </div>

          {/* Days Header */}
          <div className="grid grid-cols-7 gap-1 text-xs sm:text-sm border-b pb-2 mb-2">
            {weekDays.map((d, i) => (
              <div key={i} className="text-center font-semibold text-gray-500">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {daysInMonth.map((dayItem, idx) => {
              const holiday = getHolidayForDate(dayItem)
              const isCurrentMonth = isSameMonth(dayItem, monthStart)
              const isTodayDate = isToday(dayItem)

              return (
                <div
                  key={idx}
                  className={`min-h-[80px] sm:min-h-[100px] p-1.5 sm:p-2 border rounded relative transition-colors
                    ${!isCurrentMonth ? 'bg-gray-50 text-gray-400 border-transparent' : 'bg-white hover:shadow'}
                    ${isTodayDate ? 'ring-2 ring-primary-500' : ''}
                    ${holiday ? getHolidayColor(holiday.type).split(' ')[0] : ''}
                  `}
                  onClick={() => holiday && handleEdit(holiday)}
                >
                  <div className="flex justify-between items-start">
                    <span className={`text-xs sm:text-sm font-medium ${!isCurrentMonth ? 'text-gray-400' : 'text-gray-700'}`}>
                      {format(dayItem, 'd')}
                    </span>
                    {holiday && (
                      <div className="flex space-x-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEdit(holiday); }}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <FaEdit size={10} />
                        </button>
                      </div>
                    )}
                  </div>

                  {holiday && (
                    <div className={`mt-1 p-1 rounded text-[10px] sm:text-xs border ${getHolidayColor(holiday.type)}`}>
                      <div className="font-semibold truncate" title={holiday.name}>
                        {holiday.name}
                      </div>
                      <div className="text-[9px] sm:text-[10px] opacity-75 capitalize">
                        {holiday.type}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const groupHolidaysByMonth = () => {
    const grouped = {}
    holidays.forEach((holiday) => {
      const date = new Date(holiday.date)
      const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      if (!grouped[monthYear]) {
        grouped[monthYear] = []
      }
      grouped[monthYear].push(holiday)
    })
    return grouped
  }

  const groupedHolidays = groupHolidaysByMonth()

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">Holidays</h1>
          <p className="text-gray-600 text-sm mt-1">Manage company holidays and observances</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          {/* View Toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1 ${viewMode === 'calendar' ? 'bg-white shadow text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
              title="Calendar View"
            >
              <FaTh />
              <span className="hidden sm:inline">calendar</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1 ${viewMode === 'list' ? 'bg-white shadow text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
              title="List View"
            >
              <FaList />
              <span className="hidden sm:inline">list</span>
            </button>
          </div>

          <Button
            onPress={() => setShowModal(true)}
            color="primary"
            startContent={<FaPlus />}
            size="sm"
          >
            Add Holiday
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 border-l-4 border-primary-500">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Total Holidays</h3>
            <FaCalendarAlt className="text-primary-500 text-sm sm:text-base" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">{holidays.length}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Public Holidays</h3>
            <FaCalendarAlt className="text-green-500 text-sm sm:text-base" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {holidays.filter(h => h.type === 'public').length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Upcoming Holidays</h3>
            <FaCalendarAlt className="text-blue-500 text-sm sm:text-base" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {holidays.filter(h => new Date(h.date) >= new Date(new Date().setHours(0, 0, 0, 0))).length}
          </div>
        </div>
      </div>

      {/* Main Content */}
      {error ? (
        <DataErrorState message="Failed to load holidays" onRetry={() => refreshHolidays()} />
      ) : isLoading ? (
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-7 gap-2">
            {[...Array(35)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {viewMode === 'calendar' ? (
            renderCalendar()
          ) : (
            /* List View */
            <div className="space-y-6">
              {holidays.length === 0 ? (
                <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
                  No holidays found
                </div>
              ) : (
                Object.entries(groupedHolidays).map(([monthYear, monthHolidays]) => (
                  <div key={monthYear} className="bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                      <h2 className="text-lg font-semibold text-gray-800">{monthYear}</h2>
                    </div>
                    <div className="divide-y divide-gray-200">
                      {monthHolidays.map((holiday) => (
                        <div
                          key={holiday._id}
                          className="p-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="bg-primary-50 p-3 rounded-lg min-w-[60px] text-center">
                                <div className="text-xl font-bold text-primary-600">
                                  {new Date(holiday.date).getDate()}
                                </div>
                                <div className="text-xs text-primary-600 uppercase">
                                  {new Date(holiday.date).toLocaleDateString('en-US', { weekday: 'short' })}
                                </div>
                              </div>
                              <div>
                                <h3 className="text-base font-semibold text-gray-800">{holiday.name}</h3>
                                {holiday.description && (
                                  <p className="text-gray-500 text-sm">{holiday.description}</p>
                                )}
                                <div className="mt-1 flex flex-wrap gap-2">
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${holiday.type === 'public' ? 'bg-green-100 text-green-800' :
                                    holiday.type === 'company' ? 'bg-blue-100 text-blue-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                    {holiday.type}
                                  </span>
                                  {holiday.locations && holiday.locations.length > 0 && (
                                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                                      {holiday.locations.join(', ')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleEdit(holiday)}
                                className="text-blue-600 hover:text-blue-800 p-2 rounded-full hover:bg-blue-50"
                              >
                                <FaEdit />
                              </button>
                              <button
                                onClick={() => handleDelete(holiday._id)}
                                className="text-red-600 hover:text-red-800 p-2 rounded-full hover:bg-red-50"
                              >
                                <FaTrash />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onOpenChange={(open) => !open && handleCloseModal()} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                {editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
              </ModalHeader>
              <form onSubmit={handleSubmit}>
                <ModalBody className="space-y-4">
                  <Input
                    type="text"
                    label="Holiday Name"
                    isRequired
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., New Year's Day"
                  />

                  <Input
                    type="date"
                    label="Date"
                    isRequired
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  />

                  <Select
                    label="Type"
                    isRequired
                    selectedKeys={formData.type ? [formData.type] : ['public']}
                    onSelectionChange={(keys) => setFormData({ ...formData, type: Array.from(keys)[0] || 'public' })}
                  >
                    <SelectItem key="public">Public Holiday</SelectItem>
                    <SelectItem key="company">Company Holiday</SelectItem>
                  </Select>

                  <Select
                    label="Applicable To"
                    selectedKeys={formData.applicableTo ? [formData.applicableTo] : ['all']}
                    onSelectionChange={(keys) => setFormData({ ...formData, applicableTo: Array.from(keys)[0] || 'all' })}
                  >
                    <SelectItem key="all">All Locations</SelectItem>
                    <SelectItem key="specific-locations">Specific Locations</SelectItem>
                  </Select>

                  {formData.applicableTo === 'specific-locations' && (
                    <div>
                      <label className="text-sm font-medium text-default-700 mb-2 block">Select Locations (Countries)</label>
                      <div className="border border-default-200 rounded-lg p-2 max-h-40 overflow-y-auto">
                        {countries.map((country) => (
                          <Checkbox
                            key={country}
                            isSelected={formData.locations.includes(country)}
                            onValueChange={(isSelected) => {
                              if (isSelected) {
                                setFormData({
                                  ...formData,
                                  locations: [...formData.locations, country]
                                })
                              } else {
                                setFormData({
                                  ...formData,
                                  locations: formData.locations.filter(l => l !== country)
                                })
                              }
                            }}
                            className="w-full p-2"
                          >
                            {country}
                          </Checkbox>
                        ))}
                      </div>
                    </div>
                  )}

                  <Textarea
                    label="Description"
                    minRows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Holiday description"
                  />
                </ModalBody>

                <ModalFooter>
                  <Button variant="light" onPress={handleCloseModal}>
                    Cancel
                  </Button>
                  <LoadingButton
                    color="primary"
                    type="submit"
                    isLoading={submitMutation.isLoading}
                    loadingText={editingHoliday ? 'Updating...' : 'Creating...'}
                  >
                    {editingHoliday ? 'Update' : 'Create'}
                  </LoadingButton>
                </ModalFooter>
              </form>
            </>
          )}
        </ModalContent>
      </Modal>

    </div>
  )
}

