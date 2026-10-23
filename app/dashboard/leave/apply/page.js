'use client'


import { Heading1, Heading3 } from '@/components/ui/fernly/native'
import BackIcon from '@/components/ui/BackIcon'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardBody, Button, Skeleton, Input, Textarea, Select, SelectItem } from '@/components/ui/fernly'
import toast from '@/utils/toast'
import { FaCheck } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import useLeaveBalance from '@/hooks/useLeaveBalance'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import BalanceStrip from '@/components/leave/BalanceStrip'
import { countLeaveDays, formatLeaveDays } from '@/lib/leaveDays'
import { currentFiscalYear, fiscalYearFor } from '@/lib/leavePolicy'

const formatUnlockDate = value => {
  if (!value) return ''
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

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
  const balanceYear = formData.startDate ? fiscalYearFor(formData.startDate) : currentFiscalYear()

  // The computed balance is the single source for the dropdown: manual types
  // (WL/BL) only appear once HR has allocated days, and the order is fixed.
  const {
    balances: leaveBalance,
    preview,
    loading: leaveBalanceLoading,
    isValidating: leaveBalanceValidating,
    error: leaveBalanceError,
    refresh: refreshBalance,
    getBalance,
  } = useLeaveBalance({
    year: balanceYear,
    employeeId,
    enabled: Boolean(employeeId),
    startDate: formData.startDate || undefined,
    endDate: formData.endDate || undefined,
  })

  const loading = leaveBalanceLoading
  const isValidating = leaveBalanceValidating
  const error = leaveBalanceError

  const selectedBalance = useMemo(() => {
    if (!formData.leaveType) return null
    return getBalance(formData.leaveType)
  }, [formData.leaveType, getBalance])
  const selectedType = selectedBalance?.leaveType || null

  // Submit mutation
  const submitLeave = useApiMutation({
    method: 'POST',
    invalidateKeys: [
      /^\/api\/leave/,
    ],
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
      refreshBalance()
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

  const calculateDays = () => countLeaveDays(formData.startDate, formData.endDate)
  const days = calculateDays()
  const requiresBalance = selectedBalance?.requiresBalance !== false
  const availableBalance = requiresBalance ? Number(selectedBalance?.available ?? 0) : null
  const paidDays = preview ? Number(preview.paidDays || 0) : days
  const lockedTill = selectedBalance?.isLocked ? formatUnlockDate(selectedBalance.unlocksOn) : ''
  const hasDates = Boolean(formData.startDate && formData.endDate)
  const dateError = hasDates && formData.endDate < formData.startDate
    ? 'End date cannot be before start date'
    : ''
  const noWorkingDays = hasDates && !dateError && days === 0
    ? 'The selected dates contain no working days. Sundays are excluded.'
    : ''
  const lockedError = lockedTill ? `${selectedType?.name || 'This leave type'} is locked till ${lockedTill}` : ''
  const noticeError = preview?.violation?.message || ''
  const balanceError = requiresBalance && formData.leaveType && hasDates && !dateError && paidDays > availableBalance
    ? `Only ${availableBalance} ${selectedType?.code || 'leave'} available for ${paidDays} paid day${paidDays === 1 ? '' : 's'}`
    : ''
  const inlineError = dateError || noWorkingDays || lockedError || noticeError || balanceError

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Full-day leave requires a leave type; WFH and half-day have separate flows.
    if (!formData.leaveType) {
      toast.error('Please select a leave type')
      return
    }

    if (days === 0) {
      toast.error('Please select valid dates')
      return
    }

    if (lockedTill) {
      toast.error(`${selectedType?.name || 'This leave type'} is locked till ${lockedTill}`)
      return
    }

    if (noticeError) {
      toast.error(noticeError)
      return
    }

    if (requiresBalance && paidDays > availableBalance) {
      toast.error(`Insufficient leave balance. Available: ${formatLeaveDays(availableBalance)}`)
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
                      {leaveBalance.map((balance) => {
                        const code = String(balance.leaveType?.code || balance.leaveType?._id || '')
                        const name = balance.leaveType?.name || code
                        const locked = Boolean(balance.isLocked)
                        const unlimited = balance.requiresBalance === false
                        const left = Number(balance.available ?? 0)
                        const label = locked
                          ? `${name} (${code}) · Locked till ${formatUnlockDate(balance.unlocksOn)}`
                          : unlimited
                            ? `${name} (${code}) · No balance needed`
                            : `${name} (${code}) · ${left} left`
                        return (
                          <SelectItem
                            key={code}
                            textValue={label}
                            isDisabled={locked || (!unlimited && left <= 0)}
                          >
                            {label}
                          </SelectItem>
                        )
                      })}
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

                  {/* Live balance impact, including the notice-period split */}
                  {!leaveBalanceLoading && formData.leaveType && formData.startDate && formData.endDate && (
                    <BalanceStrip
                      balance={selectedBalance}
                      days={days}
                      typeLabel={selectedType?.code || 'leave'}
                      error={dateError || noWorkingDays}
                      preview={preview}
                      lockedTill={lockedTill}
                      requiresBalance={requiresBalance}
                    />
                  )}
                  {!formData.leaveType && (dateError || noWorkingDays) && (
                    <p className="text-sm text-danger">{dateError || noWorkingDays}</p>
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
                      loadingText="Submitting..."
                      isDisabled={submitLeave.isLoading || !formData.leaveType || days === 0 || Boolean(inlineError)}
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
                  {leaveBalance.map((balance) => {
                    const isSelected = String(balance.leaveType?.code || balance.leaveType?._id) === String(formData.leaveType)
                    // totalDays already includes carried-forward days on the server projection.
                    const capacity = balance.totalDays
                    const usedPercent = capacity > 0 ? Math.min(100, ((balance.usedDays + balance.pending) / capacity) * 100) : 0
                    const credited = balance.yearlyEntitlement != null
                      ? `${balance.accrued} of ${balance.yearlyEntitlement} credited`
                      : balance.manualAllocation
                        ? `Allocated: ${formatLeaveDays(balance.totalDays)}`
                        : 'No balance needed'
                    const locked = balance.isLocked === true
                    const unlimited = balance.requiresBalance === false
                    return (
                      <div
                        key={balance._id}
                        className={`border rounded-lg p-4 transition-colors ${isSelected ? 'border-primary bg-primary-50' : 'border-default-200'}`}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-medium text-default-800">{balance.leaveType?.name}</h4>
                          <span className="text-sm text-default-500">{balance.leaveType?.code}</span>
                        </div>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-default-600">Credited:</span>
                            <span className="font-medium text-success">{credited}</span>
                          </div>
                          {balance.carriedForward > 0 && (
                            <div className="flex justify-between">
                              <span className="text-default-600">Carried forward:</span>
                              <span className="font-medium">{formatLeaveDays(balance.carriedForward)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-default-600">Used:</span>
                            <span className="text-danger">{formatLeaveDays(balance.usedDays)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-default-600">Pending:</span>
                            <span className="text-warning-600">{formatLeaveDays(balance.pending)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-default-600">Available:</span>
                            <span className={`font-medium ${locked || unlimited ? 'text-default-500' : 'text-blue-600'}`}>
                              {unlimited
                                ? 'No limit'
                                : locked
                                  ? `Locked till ${formatUnlockDate(balance.unlocksOn)}`
                                  : formatLeaveDays(balance.available)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2">
                          <div className="w-full bg-default-200 rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full"
                              style={{ width: `${usedPercent}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
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
