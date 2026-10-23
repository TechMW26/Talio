'use client'

import { NativeTable, SummaryCard } from '@/components/ui/fernly'
import { Heading1, Heading3 } from '@/components/ui/fernly/native'
import { useEffect, useMemo, useState } from 'react'
import { Card, CardBody, Button, Chip, Skeleton, Select, SelectItem } from '@/components/ui/fernly'
import toast from '@/utils/toast'
import { FaMoneyBillWave, FaCheckCircle, FaSyncAlt } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import { currentFiscalYear, fiscalYearLabel } from '@/lib/leavePolicy'

const ENCASHMENT_ROLES = ['admin', 'hr', 'super_admin', 'superadmin']

const money = value => {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
    : '—'
}

const formatDay = value => {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const STATUS_META = {
  ready: { label: 'Ready', color: 'success' },
  salary_missing: { label: 'Salary missing', color: 'danger' },
  ineligible: { label: 'Under 1 year', color: 'default' },
  nothing_to_encash: { label: 'Nothing to encash', color: 'default' },
  pending_payout: { label: 'Pending payout', color: 'warning' },
  paid: { label: 'Paid', color: 'success' },
}

export default function LeaveEncashmentPage() {
  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
  }, [])
  const authorized = Boolean(user && ENCASHMENT_ROLES.includes(user.role))
  const [year, setYear] = useState(currentFiscalYear())

  useEffect(() => {
    if (user && !authorized) {
      toast.error('Access denied. Only HR and Admin can run leave encashment.')
      window.location.href = '/dashboard'
    }
  }, [user, authorized])

  const { data, error, isLoading, isValidating, mutate } = useAuthedSWR(
    authorized ? `/api/leave/encashment?year=${year}` : null
  )
  const preview = data?.data || null
  const rows = preview?.rows || []
  const totals = preview?.totals || {}
  const confirmOpen = Boolean(preview?.fiscalYearEnd)
    && new Date(`${preview.fiscalYearEnd}T00:00:00Z`).getTime() <= Date.now()

  const confirmRun = useApiMutation({
    method: 'POST',
    onSuccess: result => {
      toast.success(`Encashment created for ${result?.data?.created ?? 0} employee(s)`)
      mutate()
    },
    onError: err => toast.error(typeof err === 'string' ? err : err?.message || 'Encashment run failed'),
  })

  const markPaid = useApiMutation({
    method: 'PATCH',
    onSuccess: () => {
      toast.success('Encashment marked as paid')
      mutate()
    },
    onError: err => toast.error(typeof err === 'string' ? err : err?.message || 'Could not mark as paid'),
  })

  const handleConfirm = async () => {
    if (!preview) return
    if (!window.confirm(`Encash Earned Leave for ${totals.ready || 0} employee(s) totalling ${money(totals.amount)}?`)) return
    await confirmRun.execute('/api/leave/encashment', { year })
  }

  const handleMarkPaid = async row => {
    const reference = window.prompt('Payment reference (bank / UTR / voucher):', '')
    if (reference === null) return
    await markPaid.execute('/api/leave/encashment', { year, ids: [row.encashmentId], paymentReference: reference })
  }

  if (!user) {
    return (
      <div className="page-container">
        <Skeleton className="h-10 w-64 rounded-lg mb-4" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="page-container space-y-4 sm:space-y-6 pb-24 md:pb-6">
      <BackgroundRefreshIndicator isRefreshing={isValidating && !isLoading} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading1 className="flex items-center gap-2 text-2xl font-bold text-default-800">
            <FaMoneyBillWave className="text-primary" aria-hidden="true" /> Leave Encashment
          </Heading1>
          <p className="text-sm text-default-500 mt-1">
            Encash unused Earned Leave at the 31 March close. Payouts fall in June–August.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label="Fiscal year"
            size="sm"
            className="min-w-[170px]"
            selectedKeys={[String(year)]}
            onSelectionChange={keys => setYear(Number(Array.from(keys)[0]))}
          >
            {Array.from({ length: 5 }, (_, index) => currentFiscalYear() - index).map(value => (
              <SelectItem key={String(value)}>{fiscalYearLabel(value)}</SelectItem>
            ))}
          </Select>
          <Button size="sm" variant="flat" onPress={() => mutate()} startContent={<FaSyncAlt className="w-3.5 h-3.5" />}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <DataErrorState message="Failed to load the encashment preview" onRetry={() => mutate()} />
      ) : isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard shadow="sm" label="Eligible employees" value={totals.eligible ?? 0} />
            <SummaryCard shadow="sm" label="Ready to encash" value={totals.ready ?? 0} />
            <SummaryCard shadow="sm" label="Earned Leave days" value={totals.days ?? 0} />
            <SummaryCard shadow="sm" label="Payout amount" value={money(totals.amount ?? 0)} />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-default-500">
            <span>{preview?.fiscalYearLabel} · closes 31 Mar {String(Number(year) + 1)}</span>
            {preview?.payoutWindow && <span>Payout window: {formatDay(preview.payoutWindow.from)} – {formatDay(preview.payoutWindow.to)}</span>}
            <span>Salary field: <code>{preview?.salaryField}</code></span>
          </div>

          {Number(totals.missingSalary) > 0 && (
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
              {totals.missingSalary} employee(s) have no <strong>{preview?.salaryField}</strong> recorded. Their amount stays empty and they are
              skipped when confirming — fix the salary and run the preview again.
            </div>
          )}

          <Card shadow="sm">
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <NativeTable className="min-w-full divide-y divide-default-200">
                  <thead className="bg-default-50">
                    <tr>
                      {['Employee', 'Code', 'Joined', 'Service', 'EL days', 'Salary', 'Amount', 'Status'].map(heading => (
                        <th key={heading} className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                          {heading}
                        </th>
                      ))}
                      <th data-sticky-actions="true" className="px-4 py-3 text-right text-xs font-medium text-default-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-content1 divide-y divide-default-200">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-sm text-default-500">
                          No employees found for {fiscalYearLabel(year)}
                        </td>
                      </tr>
                    ) : rows.map(row => {
                      const meta = STATUS_META[row.status] || { label: row.status, color: 'default' }
                      return (
                        <tr key={row.employee._id} className="hover:bg-default-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-default-800">
                            {[row.employee.firstName, row.employee.lastName].filter(Boolean).join(' ') || row.employee.employeeCode || 'Employee'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-default-600">{row.employee.employeeCode || '—'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-default-600">{formatDay(row.employee.dateOfJoining)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-default-600">{row.serviceYears} yr</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-default-800">{row.days}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-default-600">{row.salary == null ? '—' : money(row.salary)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-default-800">{row.amount == null ? '—' : money(row.amount)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Chip size="sm" variant="flat" color={meta.color}>{meta.label}</Chip>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            {row.status === 'pending_payout' && (
                              <Button
                                size="sm"
                                variant="flat"
                                isLoading={markPaid.isLoading}
                                onPress={() => handleMarkPaid(row)}
                                startContent={<FaCheckCircle className="w-3.5 h-3.5" />}
                              >
                                Mark paid
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </NativeTable>
              </div>
            </CardBody>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs text-default-500">
                Confirming writes one record per employee and fiscal year. Re-running is safe — existing records are skipped, never doubled.
              </p>
              {!confirmOpen && preview?.fiscalYearEnd && (
                <p className="text-xs font-medium text-warning-600">
                  Confirm unlocks after {formatDay(preview.fiscalYearEnd)}.
                </p>
              )}
            </div>
            <Button
              color="primary"
              onPress={handleConfirm}
              isDisabled={confirmRun.isLoading || !confirmOpen || Number(totals.ready) === 0}
              isLoading={confirmRun.isLoading}
            >
              Confirm encashment
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
