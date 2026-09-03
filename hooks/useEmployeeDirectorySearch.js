'use client'

import { useEffect, useMemo, useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'

export default function useEmployeeDirectorySearch({
  enabled = true,
  query = '',
  limit = 50,
  includeAdmins = true,
  includeSelf = false,
  debounceMs = 250,
} = {}) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), debounceMs)
    return () => clearTimeout(timer)
  }, [query, debounceMs])

  const endpoint = useMemo(() => {
    if (!enabled) return null
    const params = new URLSearchParams({
      limit: String(limit),
      includeAdmins: String(includeAdmins),
      includeSelf: String(includeSelf),
    })
    if (debouncedQuery) params.set('q', debouncedQuery)
    return `/api/directory?${params.toString()}`
  }, [enabled, limit, includeAdmins, includeSelf, debouncedQuery])

  const result = useAuthedSWR(endpoint, { keepPreviousData: false })

  return {
    ...result,
    employees: result.data?.data || [],
    debouncedQuery,
  }
}
