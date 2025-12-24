'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { 
  FaPlus, FaEdit, FaTrash, FaCalendarAlt, FaSync, FaRobot, 
  FaList, FaTh, FaChevronLeft, FaChevronRight 
} from 'react-icons/fa'
import ModalPortal from '@/components/ui/ModalPortal'
import { 
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, 
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, 
  parseISO, isToday 
} from 'date-fns'

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState(null)
  
  // View Mode State
  const [viewMode, setViewMode] = useState('calendar') // 'calendar' or 'list'
  const [currentMonth, setCurrentMonth] = useState(new Date())

  // AI Fetch State
  const [showAiModal, setShowAiModal] = useState(false)
  const [fetchingAi, setFetchingAi] = useState(false)
  const [aiForm, setAiForm] = useState({
    country: '',
    year: new Date().getFullYear()
  })

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

  useEffect(() => {
    fetchHolidays()
  }, [])

  // Auto-switch to list view on mobile
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])

  const fetchHolidays = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/holidays', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setHolidays(data.data)
      }
    } catch (error) {
      console.error('Fetch holidays error:', error)
      toast.error('Failed to fetch holidays')
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/holidays/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        toast.success(data.message)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Sync error:', error)
      toast.error('Failed to sync holidays with attendance')
    } finally {
      setSyncing(false)
    }
  }

  const handleAiFetch = async (e) => {
    e.preventDefault()
    if (!aiForm.country) {
      toast.error('Please select a country')
      return
    }

    setFetchingAi(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/holidays/fetch-ai', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(aiForm)
      })

      const data = await response.json()
      if (data.success) {
        toast.success(data.message)
        setShowAiModal(false)
        fetchHolidays()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('AI Fetch error:', error)
      toast.error('Failed to fetch holidays with AI')
    } finally {
      setFetchingAi(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    try {
      const token = localStorage.getItem('token')
      const url = editingHoliday
        ? `/api/holidays/${editingHoliday._id}`
        : '/api/holidays'
      const method = editingHoliday ? 'PUT' : 'POST'

      // Add year automatically
      const dataToSend = {
        ...formData,
        year: new Date(formData.date).getFullYear()
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(dataToSend),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        handleCloseModal()
        fetchHolidays()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Submit error:', error)
      toast.error('Failed to save holiday')
    }
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

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this holiday?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/holidays/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        fetchHolidays()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete holiday')
    }
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
      case 'optional': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'restricted': return 'bg-orange-100 text-orange-800 border-orange-200'
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

          <button
            onClick={() => setShowAiModal(true)}
            className="btn-secondary flex items-center space-x-2 bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 text-sm"
          >
            <FaRobot />
            <span className="hidden sm:inline">Fetch with AI</span>
            <span className="sm:hidden">AI</span>
          </button>

          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-secondary flex items-center space-x-2 text-sm"
          >
            <FaSync className={syncing ? 'animate-spin' : ''} />
            <span>Sync</span>
          </button>
          
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center space-x-2 text-sm"
          >
            <FaPlus />
            <span>Add Holiday</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 border-l-4 border-primary-500">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Total Holidays</h3>
            <FaCalendarAlt className="text-primary-500 text-sm sm:text-base" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">{holidays.length}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Public Holidays</h3>
            <FaCalendarAlt className="text-green-500 text-sm sm:text-base" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {holidays.filter(h => h.type === 'public').length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Optional Holidays</h3>
            <FaCalendarAlt className="text-blue-500 text-sm sm:text-base" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {holidays.filter(h => h.type === 'optional').length}
          </div>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading holidays...</p>
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
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                    holiday.type === 'public' ? 'bg-green-100 text-green-800' :
                                    holiday.type === 'optional' ? 'bg-blue-100 text-blue-800' :
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
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && handleCloseModal()}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h2 className="modal-title">
                {editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
              </h2>
              <button onClick={handleCloseModal} className="modal-close-btn">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-4">
                <div>
                  <label className="modal-label">Holiday Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="modal-input"
                    placeholder="e.g., New Year's Day"
                  />
                </div>

                <div>
                  <label className="modal-label">Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="modal-input"
                  />
                </div>

                <div>
                  <label className="modal-label">Type *</label>
                  <select
                    required
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="modal-select"
                  >
                    <option value="public">Public Holiday</option>
                    <option value="optional">Optional Holiday</option>
                    <option value="restricted">Restricted Holiday</option>
                  </select>
                </div>

                <div>
                  <label className="modal-label">Applicable To</label>
                  <select
                    value={formData.applicableTo}
                    onChange={(e) => setFormData({ ...formData, applicableTo: e.target.value })}
                    className="modal-select"
                  >
                    <option value="all">All Locations</option>
                    <option value="specific-locations">Specific Locations</option>
                  </select>
                </div>

                {formData.applicableTo === 'specific-locations' && (
                  <div>
                    <label className="modal-label">Select Locations (Countries)</label>
                    <div className="border border-gray-300 rounded-lg p-2 max-h-40 overflow-y-auto">
                      {countries.map((country) => (
                        <label key={country} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.locations.includes(country)}
                            onChange={(e) => {
                              if (e.target.checked) {
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
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                          />
                          <span className="text-sm text-gray-700">{country}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="modal-label">Description</label>
                  <textarea
                    rows="3"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="modal-textarea"
                    placeholder="Holiday description"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={handleCloseModal} className="modal-btn modal-btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="modal-btn modal-btn-primary">
                  {editingHoliday ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {/* AI Fetch Modal */}
      <ModalPortal isOpen={showAiModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowAiModal(false)}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-sm">
            <div className="modal-header">
              <h2 className="modal-title flex items-center gap-2">
                Fetch Holidays with AI
              </h2>
              <button onClick={() => setShowAiModal(false)} className="modal-close-btn">×</button>
            </div>
            <form onSubmit={handleAiFetch}>
              <div className="modal-body space-y-4">
                <p className="text-sm text-gray-600">
                  Automatically fetch and populate public holidays for a specific country using MAYA AI.
                </p>
                
                <div>
                  <label className="modal-label">Country *</label>
                  <select
                    required
                    value={aiForm.country}
                    onChange={(e) => setAiForm({ ...aiForm, country: e.target.value })}
                    className="modal-select"
                  >
                    <option value="">Select Country</option>
                    {countries.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="modal-label">Year *</label>
                  <input
                    type="number"
                    required
                    min="2020"
                    max="2030"
                    value={aiForm.year}
                    onChange={(e) => setAiForm({ ...aiForm, year: e.target.value })}
                    className="modal-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowAiModal(false)} className="modal-btn modal-btn-secondary">
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={fetchingAi}
                  className="modal-btn bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {fetchingAi ? (
                    <>
                      <FaSync className="animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <FaRobot />
                      Fetch Holidays
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

