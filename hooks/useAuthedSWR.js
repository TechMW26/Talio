'use client'

import useSWR from 'swr'

const authedFetcher = async (url) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined

  const response = await fetch(url, { headers })
  const data = await response.json()

  if (!response.ok || data?.success === false) {
    const message = data?.message || 'Failed to fetch data'
    throw new Error(message)
  }

  return data
}

export default function useAuthedSWR(key, options = {}) {
  return useSWR(key, authedFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 60_000,
    ...options,
  })
}
