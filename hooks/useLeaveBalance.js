'use client'

import { useMemo } from 'react'
import useAuthedSWR from './useAuthedSWR'
import { normalizeLeaveBalances } from '@/lib/leaveData'
import { currentFiscalYear } from '@/lib/leavePolicy'

function balanceKey(balance) {
  return [
    balance?.leaveType?._id,
    balance?.leaveType?.code,
    balance?.leaveType?.name,
    balance?.leaveType,
  ].filter(Boolean).map(value => String(value).trim().toLowerCase())
}

/**
 * Fetches the server-computed leave balance so every screen uses the same
 * approved/pending request totals.
 */
export default function useLeaveBalance({ year = currentFiscalYear(), employeeId, enabled = true, startDate, endDate } = {}) {
  const query = new URLSearchParams({ year: String(year), summary: '1' })
  if (employeeId) query.set('employeeId', employeeId)
  if (startDate && endDate) {
    query.set('startDate', startDate)
    query.set('endDate', endDate)
  }
  const { data, error, isLoading, isValidating, mutate } = useAuthedSWR(
    enabled ? `/api/leave/balance?${query.toString()}` : null
  )

  const balances = useMemo(() => normalizeLeaveBalances(data?.data || []), [data])

  return {
    balances,
    preview: data?.preview || null,
    error,
    loading: isLoading,
    isValidating,
    refresh: mutate,
    getBalance(code) {
      const key = String(code || '').trim().toLowerCase()
      if (!key) return null
      return balances.find(balance => balanceKey(balance).includes(key)) || null
    },
  }
}
