'use client'


import { Heading1, Heading3 } from '@/components/ui/fernly/native'
import BackIcon from '@/components/ui/BackIcon'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardBody, Button, Skeleton, Input, Textarea, Select, SelectItem } from '@/components/ui/fernly'
import toast from '@/utils/toast'
import { FaCalendarAlt, FaPlus, FaCheck } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import {
  calculateLeaveDays,
  normalizeLeaveBalances,
} from '@/lib/leaveData'

export default function ApplyLeavePage() {
  const router = useRouter()

  // Derive user/employeeId from localStorage
  const user = useMemo(() => getCurrentUser(), [])
  const employeeId = useMemo(() => user ? getEmployeeId(user) : null, [user])
  const [formData, setFormData] = useState({
    leaveType: '',
    startDate: '',
    endDate: '',
    reason: '',
    emergencyContact: '',
    handoverNotes: '',
  })
  const balanceYear = Number(formData.startDate.slice(0, 4)) || new Date().getFullYear()

  // SWR data fetching
  const { data: leaveTypesRes, error: leaveTypesError, isLoading: leaveTypesLoading, isValidating: leaveTypesValidating } = useAuthedSWR('/api/leave/types')
  const { data: leaveBalanceRes, error: leaveBalanceError, isLoading: leaveBalanceLoading, isValidating: leaveBalanceValidating, mutate: refreshBalance } = useAuthedSWR(
    employeeId ? `/api/leave/balance?employeeId=${employeeId}&year=${balanceYear}` : null
  )

  const leaveTypes = useMemo(() => (leaveTypesRes?.data || []).filter(type => type.isActive), [leaveTypesRes])
  const leaveBalance = useMemo(
    () => normalizeLeaveBalances(leaveBalanceRes?.data || []),
    [leaveBalanceRes]
  )
  const loading = leaveTypesLoading || leaveBalanceLoading
  const isValidating = leaveTypesValidating || leaveBalanceValidating
  const error = leaveTypesError || leaveBalanceError

  // Submit mutation
  const submitLeave = useApiMutation({
    method: 'POST',
    invalidateKeys: [
      employeeId ? `/api/leave/balance?employeeId=${employeeId}&year=${balanceYear}` : null,
      /^\/api\/leave/,
    ].filter(Boolean),
    onSuccess: () => {
      toast.success('Leave application submitted successfully!')
      setFormData({
        leaveType: '',
        startDate: '',
        endDate: '',
        reason: '',
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
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const calculateDays = () => calculateLeaveDays(
    formData.startDate,
    formData.endDate,
    false
  )

  const getAvailableBalance = () => {
    if (!formData.leaveType) return 0
    const balance = leaveBalance.find(balanceItem =>
      String(balanceItem.leaveType?._id || balanceItem.leaveType) === String(formData.leaveType)
    )
    return balance?.remainingDays ?? 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const days = calculateDays()
    const availableBalance = getAvailableBalance()

    // Full-day leave requires a leave type; WFH and half-day have separate flows.
    if (!formData.leaveType) {
      toast.error('Please select a leave type')
      return
    }

    if (days === 0) {
      toast.error('Please select valid dates')
      return
    }

    if (formData.leaveType && days > availableBalance) {
      toast.error(`Insufficient leave balance. Available: ${availableBalance} days`)
      return
    }


    await submitLeave.execute('/api/leave', {
      ...formData,
      requestType: 'leave',
      isHalfDay: false,
      workFromHome: false,
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

  if (error) {
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
          <BackIcon className="w-4 h-4 sm:w-5 sm:h-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <Heading1 className="text-2xl sm:text-3xl font-bold text-default-800 truncate">Apply for Leave</Heading1>
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
                      placeholder="Select Leave Type"
                      selectedKeys={formData.leaveType ? [formData.leaveType] : []}
                      onSelectionChange={(keys) => setFormData({ ...formData, leaveType: Array.from(keys)[0] || '' })}
                      isRequired
                    >
                      {leaveTypes.map((type) => (
                        <SelectItem key={type._id} textValue={`${type.name} (${type.code})`}>
                          {type.name} ({type.code})
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  {/* Date Range */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      type="date"
                      label="Start Date"
                      name="startDate"
                      value={formData.startDate}
                      onChange={handleChange}
                      isRequired
                    />
                    <Input
                      type="date"
                      label="End Date"
                      name="endDate"
                      value={formData.endDate}
                      onChange={handleChange}
                      min={formData.startDate || undefined}
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
                          {`Available Balance: ${getAvailableBalance()} days`}
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
              <Heading3 className="text-lg font-semibold text-default-800 mb-4">Leave Balance</Heading3>
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
