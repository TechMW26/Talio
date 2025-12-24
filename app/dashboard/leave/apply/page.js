'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaCalendarAlt, FaPlus, FaArrowLeft, FaCheck } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'

export default function ApplyLeavePage() {
  const [leaveTypes, setLeaveTypes] = useState([])
  const [leaveBalance, setLeaveBalance] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [user, setUser] = useState(null)
  const [employeeId, setEmployeeId] = useState(null)
  const router = useRouter()
  
  const [formData, setFormData] = useState({
    leaveType: '',
    startDate: '',
    endDate: '',
    reason: '',
    isHalfDay: false,
    halfDayPeriod: 'morning', // morning or afternoon
    workFromHome: false,
    emergencyContact: '',
    handoverNotes: '',
  })

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const empId = getEmployeeId(parsedUser)
      setEmployeeId(empId)
      fetchLeaveTypes()
      if (empId) {
        fetchLeaveBalance(empId)
      } else {
        toast.error('Employee information not found. Please logout and login again.')
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [])

  const fetchLeaveTypes = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave/types', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setLeaveTypes(data.data.filter(type => type.isActive))
      }
    } catch (error) {
      console.error('Fetch leave types error:', error)
      toast.error('Failed to fetch leave types')
    }
  }

  const fetchLeaveBalance = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave/balance?employeeId=${employeeId}&year=${new Date().getFullYear()}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setLeaveBalance(data.data)
      }
    } catch (error) {
      console.error('Fetch leave balance error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    
    // If checking Half Day or Work From Home, clear the leave type
    if (name === 'isHalfDay' && checked) {
      setFormData(prev => ({
        ...prev,
        [name]: checked,
        leaveType: '',
        workFromHome: false
      }))
    } else if (name === 'workFromHome' && checked) {
      setFormData(prev => ({
        ...prev,
        [name]: checked,
        leaveType: '',
        isHalfDay: false
      }))
    } else if (name === 'isHalfDay' && !checked) {
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }))
    } else if (name === 'workFromHome' && !checked) {
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }))
    }
  }

  const calculateDays = () => {
    if (!formData.startDate || !formData.endDate) return 0
    
    const start = new Date(formData.startDate)
    const end = new Date(formData.endDate)
    
    if (end < start) return 0
    
    const diffTime = Math.abs(end - start)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
    
    return formData.isHalfDay ? 0.5 : diffDays
  }

  const getAvailableBalance = () => {
    if (!formData.leaveType) return 0
    const balance = leaveBalance.find(b => b.leaveType._id === formData.leaveType)
    return balance ? balance.remainingDays : 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    const days = calculateDays()
    const availableBalance = getAvailableBalance()

    // Validation
    if (days === 0) {
      toast.error('Please select valid dates')
      setSubmitting(false)
      return
    }

    if (days > availableBalance) {
      toast.error(`Insufficient leave balance. Available: ${availableBalance} days`)
      setSubmitting(false)
      return
    }

    if (new Date(formData.startDate) < new Date()) {
      toast.error('Start date cannot be in the past')
      setSubmitting(false)
      return
    }

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          employee: employeeId,
          numberOfDays: days,
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Leave application submitted successfully!')
        // Reset form
        setFormData({
          leaveType: '',
          startDate: '',
          endDate: '',
          reason: '',
          isHalfDay: false,
          halfDayPeriod: 'morning',
          workFromHome: false,
          emergencyContact: '',
          handoverNotes: '',
        })
        // Redirect to leave requests page
        setTimeout(() => {
          router.push('/dashboard/leave/requests')
        }, 2000)
      } else {
        toast.error(data.message || 'Failed to submit leave application')
      }
    } catch (error) {
      console.error('Submit leave error:', error)
      toast.error('Failed to submit leave application')
    } finally {
      setSubmitting(false)
    }
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-4 sm:space-y-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center space-x-3 sm:space-x-4">
        <button
          onClick={() => router.back()}
          className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
        >
          <FaArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 truncate">Apply for Leave</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Submit your leave application for approval</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leave Application Form */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-md p-6">
            <form onSubmit={handleSubmit}>
              <div className="space-y-6">
                {/* Leave Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Leave Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="leaveType"
                    value={formData.leaveType}
                    onChange={handleChange}
                    required={!formData.isHalfDay && !formData.workFromHome}
                    disabled={formData.isHalfDay || formData.workFromHome}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">{formData.isHalfDay || formData.workFromHome ? 'Not applicable for Half Day/WFH' : 'Select Leave Type'}</option>
                    {leaveTypes.map((type) => (
                      <option key={type._id} value={type._id}>
                        {type.name} ({type.code})
                      </option>
                    ))}
                  </select>
                  {(formData.isHalfDay || formData.workFromHome) && (
                    <p className="text-xs text-gray-500 mt-1">
                      Leave type is not required for {formData.isHalfDay ? 'Half Day' : 'Work From Home'} requests
                    </p>
                  )}
                </div>

                {/* Half Day Option */}
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="isHalfDay"
                    checked={formData.isHalfDay}
                    onChange={handleChange}
                    disabled={formData.workFromHome}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <label className={`text-sm font-medium ${formData.workFromHome ? 'text-gray-400' : 'text-gray-700'}`}>
                    Half Day Leave
                  </label>
                </div>

                {/* Work From Home Option */}
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="workFromHome"
                    checked={formData.workFromHome}
                    onChange={handleChange}
                    disabled={formData.isHalfDay}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <label className={`text-sm font-medium ${formData.isHalfDay ? 'text-gray-400' : 'text-gray-700'}`}>
                    Work From Home
                  </label>
                </div>

                {/* Half Day Period */}
                {formData.isHalfDay && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Half Day Period
                    </label>
                    <select
                      name="halfDayPeriod"
                      value={formData.halfDayPeriod}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="morning">Morning (First Half)</option>
                      <option value="afternoon">Afternoon (Second Half)</option>
                    </select>
                  </div>
                )}

                {/* Date Range */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      value={formData.startDate}
                      onChange={handleChange}
                      required
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      name="endDate"
                      value={formData.endDate}
                      onChange={handleChange}
                      required
                      min={formData.startDate || new Date().toISOString().split('T')[0]}
                      disabled={formData.isHalfDay}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
                    />
                  </div>
                </div>

                {/* Days Calculation */}
                {formData.startDate && formData.endDate && (
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-800">
                        Total Days: {calculateDays()} day{calculateDays() !== 1 ? 's' : ''}
                      </span>
                      <span className="text-sm text-blue-600">
                        Available Balance: {getAvailableBalance()} days
                      </span>
                    </div>
                  </div>
                )}

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason for Leave <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    name="reason"
                    value={formData.reason}
                    onChange={handleChange}
                    required
                    rows={4}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Please provide a detailed reason for your leave..."
                  />
                </div>

                {/* Emergency Contact */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Emergency Contact (Optional)
                  </label>
                  <input
                    type="text"
                    name="emergencyContact"
                    value={formData.emergencyContact}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Contact number during leave"
                  />
                </div>

                {/* Handover Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Work Handover Notes (Optional)
                  </label>
                  <textarea
                    name="handoverNotes"
                    value={formData.handoverNotes}
                    onChange={handleChange}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Any important work handover instructions..."
                  />
                </div>

                {/* Submit Button */}
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    {submitting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <>
                        <FaCheck className="w-4 h-4" />
                        <span>Submit Application</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Leave Balance Sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Leave Balance</h3>
            {leaveBalance.length === 0 ? (
              <p className="text-gray-500 text-sm">No leave balance found</p>
            ) : (
              <div className="space-y-4">
                {leaveBalance.map((balance) => (
                  <div key={balance._id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-medium text-gray-800">{balance.leaveType?.name}</h4>
                      <span className="text-sm text-gray-500">{balance.leaveType?.code}</span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total:</span>
                        <span className="font-medium">{balance.totalDays} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Used:</span>
                        <span className="text-red-600">{balance.usedDays} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Remaining:</span>
                        <span className="text-green-600 font-medium">{balance.remainingDays} days</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-primary-500 h-2 rounded-full" 
                          style={{ width: `${(balance.usedDays / balance.totalDays) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Tips */}
          <div className="bg-yellow-50 rounded-lg p-4 mt-6">
            <h4 className="font-medium text-yellow-800 mb-2">Quick Tips</h4>
            <ul className="text-sm text-yellow-700 space-y-1">
              <li>• Apply for leave at least 2 days in advance</li>
              <li>• Check your leave balance before applying</li>
              <li>• Provide detailed reason for approval</li>
              <li>• Add emergency contact for urgent matters</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
