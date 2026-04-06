'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardBody, Button, Skeleton, Input, Textarea, Select, SelectItem, Checkbox } from '@heroui/react'
import toast from '@/utils/toast'
import { FaCalendarAlt, FaPlus, FaArrowLeft, FaCheck } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function ApplyLeavePage() {
  const router = useRouter()

  // Derive user/employeeId from localStorage
  const user = useMemo(() => getCurrentUser(), [])
  const employeeId = useMemo(() => user ? getEmployeeId(user) : null, [user])

  // SWR data fetching
  const { data: leaveTypesRes, error: leaveTypesError, isLoading: leaveTypesLoading, isValidating: leaveTypesValidating } = useAuthedSWR('/api/leave/types')
  const { data: leaveBalanceRes, error: leaveBalanceError, isLoading: leaveBalanceLoading, isValidating: leaveBalanceValidating, mutate: refreshBalance } = useAuthedSWR(
    employeeId ? `/api/leave/balance?employeeId=${employeeId}&year=${new Date().getFullYear()}` : null
  )

  const leaveTypes = useMemo(() => (leaveTypesRes?.data || []).filter(type => type.isActive), [leaveTypesRes])
  const leaveBalance = leaveBalanceRes?.data || []
  const loading = leaveTypesLoading || leaveBalanceLoading
  const isValidating = leaveTypesValidating || leaveBalanceValidating
  const error = leaveTypesError || leaveBalanceError

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

  // Submit mutation
  const submitLeave = useApiMutation({
    method: 'POST',
    invalidateKeys: [
      employeeId ? `/api/leave/balance?employeeId=${employeeId}&year=${new Date().getFullYear()}` : null,
      /^\/api\/leave/,
    ].filter(Boolean),
    onSuccess: () => {
      toast.success('Leave application submitted successfully!')
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
      setTimeout(() => {
        router.push('/dashboard/leave/requests')
      }, 2000)
    },
    onError: (err) => toast.error(err.message || 'Failed to submit leave application'),
  })

  useEffect(() => {
    if (!employeeId && user) {
      toast.error('Employee information not found. Please logout and login again.')
    }
  }, [employeeId, user])

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

    const days = calculateDays()
    const availableBalance = getAvailableBalance()

    // Validation
    if (days === 0) {
      toast.error('Please select valid dates')
      return
    }

    if (days > availableBalance) {
      toast.error(`Insufficient leave balance. Available: ${availableBalance} days`)
      return
    }

    if (new Date(formData.startDate) < new Date()) {
      toast.error('Start date cannot be in the past')
      return
    }

    await submitLeave.execute('/api/leave', {
      ...formData,
      employee: employeeId,
      numberOfDays: days,
    })
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (error && !leaveTypes.length && !leaveBalance.length) {
    return <DataErrorState error={error} onRetry={() => refreshBalance()} />
  }

  if (loading) {
    return (
      <div className="page-container space-y-4 sm:space-y-6 pb-24 md:pb-6">
        <Skeleton className="h-10 w-1/3 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Skeleton className="h-96 rounded-lg" />
          </div>
          <div>
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-4 sm:space-y-6 pb-24 md:pb-6">
      <BackgroundRefreshIndicator isRefreshing={isValidating && !loading} />
      {/* Header */}
      <div className="flex items-center space-x-3 sm:space-x-4">
        <Button
          isIconOnly
          variant="flat"
          onPress={() => router.back()}
          className="flex-shrink-0"
        >
          <FaArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-default-800 truncate">Apply for Leave</h1>
          <p className="text-default-500 mt-1 text-sm sm:text-base">Submit your leave application for approval</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leave Application Form */}
        <div className="lg:col-span-2">
          <Card shadow="sm">
            <CardBody className="p-6">
              <form onSubmit={handleSubmit}>
                <div className="space-y-6">
                  {/* Leave Type */}
                  <div>
                    <Select
                      label="Leave Type"
                      placeholder={formData.isHalfDay || formData.workFromHome ? 'Not applicable for Half Day/WFH' : 'Select Leave Type'}
                      selectedKeys={formData.leaveType ? [formData.leaveType] : []}
                      onSelectionChange={(keys) => setFormData({ ...formData, leaveType: Array.from(keys)[0] || '' })}
                      isRequired={!formData.isHalfDay && !formData.workFromHome}
                      isDisabled={formData.isHalfDay || formData.workFromHome}
                    >
                      {leaveTypes.map((type) => (
                        <SelectItem key={type._id} textValue={`${type.name} (${type.code})`}>
                          {type.name} ({type.code})
                        </SelectItem>
                      ))}
                    </Select>
                    {(formData.isHalfDay || formData.workFromHome) && (
                      <p className="text-xs text-default-500 mt-1">
                        Leave type is not required for {formData.isHalfDay ? 'Half Day' : 'Work From Home'} requests
                      </p>
                    )}
                  </div>

                  {/* Half Day Option */}
                  <Checkbox
                    isSelected={formData.isHalfDay}
                    onValueChange={(checked) => {
                      if (checked) {
                        setFormData(prev => ({ ...prev, isHalfDay: true, leaveType: '', workFromHome: false }))
                      } else {
                        setFormData(prev => ({ ...prev, isHalfDay: false }))
                      }
                    }}
                    isDisabled={formData.workFromHome}
                  >
                    Half Day Leave
                  </Checkbox>

                  {/* Work From Home Option */}
                  <Checkbox
                    isSelected={formData.workFromHome}
                    onValueChange={(checked) => {
                      if (checked) {
                        setFormData(prev => ({ ...prev, workFromHome: true, leaveType: '', isHalfDay: false }))
                      } else {
                        setFormData(prev => ({ ...prev, workFromHome: false }))
                      }
                    }}
                    isDisabled={formData.isHalfDay}
                  >
                    Work From Home
                  </Checkbox>

                  {/* Half Day Period */}
                  {formData.isHalfDay && (
                    <Select
                      label="Half Day Period"
                      selectedKeys={[formData.halfDayPeriod]}
                      onSelectionChange={(keys) => setFormData({ ...formData, halfDayPeriod: Array.from(keys)[0] })}
                    >
                      <SelectItem key="morning">Morning (First Half)</SelectItem>
                      <SelectItem key="afternoon">Afternoon (Second Half)</SelectItem>
                    </Select>
                  )}

                  {/* Date Range */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      type="date"
                      label="Start Date"
                      name="startDate"
                      value={formData.startDate}
                      onChange={handleChange}
                      min={new Date().toISOString().split('T')[0]}
                      isRequired
                    />
                    <Input
                      type="date"
                      label="End Date"
                      name="endDate"
                      value={formData.endDate}
                      onChange={handleChange}
                      min={formData.startDate || new Date().toISOString().split('T')[0]}
                      isDisabled={formData.isHalfDay}
                      isRequired
                    />
                  </div>

                  {/* Days Calculation */}
                  {formData.startDate && formData.endDate && (
                    <div className="bg-primary-50 p-4 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-primary-800">
                          Total Days: {calculateDays()} day{calculateDays() !== 1 ? 's' : ''}
                        </span>
                        <span className="text-sm text-primary-600">
                          Available Balance: {getAvailableBalance()} days
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Reason */}
                  <Textarea
                    label="Reason for Leave"
                    name="reason"
                    value={formData.reason}
                    onChange={handleChange}
                    minRows={4}
                    placeholder="Please provide a detailed reason for your leave..."
                    isRequired
                  />

                  {/* Emergency Contact */}
                  <Input
                    label="Emergency Contact (Optional)"
                    name="emergencyContact"
                    value={formData.emergencyContact}
                    onChange={handleChange}
                    placeholder="Contact number during leave"
                  />

                  {/* Handover Notes */}
                  <Textarea
                    label="Work Handover Notes (Optional)"
                    name="handoverNotes"
                    value={formData.handoverNotes}
                    onChange={handleChange}
                    minRows={3}
                    placeholder="Any important work handover instructions..."
                  />

                  {/* Submit Button */}
                  <div className="flex justify-end gap-3">
                    <Button
                      variant="flat"
                      onPress={() => router.back()}
                    >
                      Cancel
                    </Button>
                    <LoadingButton
                      type="submit"
                      color="primary"
                      isLoading={submitLeave.isLoading}
                      startContent={!submitLeave.isLoading && <FaCheck className="w-4 h-4" />}
                    >
                      {submitLeave.isLoading ? 'Submitting...' : 'Submit Application'}
                    </LoadingButton>
                  </div>
                </div>
              </form>
            </CardBody>
          </Card>
        </div>

        {/* Leave Balance Sidebar */}
        <div className="lg:col-span-1">
          <Card shadow="sm">
            <CardBody className="p-6">
              <h3 className="text-lg font-semibold text-default-800 mb-4">Leave Balance</h3>
              {leaveBalance.length === 0 ? (
                <p className="text-default-500 text-sm">No leave balance found</p>
              ) : (
                <div className="space-y-4">
                  {leaveBalance.map((balance) => (
                    <div key={balance._id} className="border border-default-200 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-medium text-default-800">{balance.leaveType?.name}</h4>
                        <span className="text-sm text-default-500">{balance.leaveType?.code}</span>
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-default-600">Total:</span>
                          <span className="font-medium">{balance.totalDays} days</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-default-600">Used:</span>
                          <span className="text-danger">{balance.usedDays} days</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-default-600">Remaining:</span>
                          <span className="text-success font-medium">{balance.remainingDays} days</span>
                        </div>
                      </div>
                      <div className="mt-2">
                        <div className="w-full bg-default-200 rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full"
                            style={{ width: `${(balance.usedDays / balance.totalDays) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Quick Tips */}
          <div className="bg-warning-50 rounded-lg p-4 mt-6">
            <h4 className="font-medium text-warning-800 mb-2">Quick Tips</h4>
            <ul className="text-sm text-warning-700 space-y-1">
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
