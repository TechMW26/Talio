'use client'

import { useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { subscribeToClientDataChanges } from '@/lib/clientDataSync'

async function loadFeed() {
  const token = localStorage.getItem('token')
  if (!token) throw new Error('Please sign in again.')
  const response = await fetch('/api/mira/proactive', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  const body = await response.json()
  if (localStorage.getItem('token') !== token) throw new Error('Account changed.')
  if (!response.ok || !body.success) throw new Error(body.message || 'Mira attention is temporarily unavailable.')
  return body.data
}

export default function useMiraProactive({ enabled = false, accountKey = '', backgroundActive = false } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled && accountKey ? ['mira-attention', accountKey] : null, loadFeed, {
    // Native PiP is visible in a separate document while the main document can
    // be hidden. Keep its feed alive only while Mira itself is open.
    refreshInterval: 30000, refreshWhenHidden: backgroundActive, refreshWhenOffline: false,
    revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 15000,
    keepPreviousData: false, shouldRetryOnError: false,
  })
  const refresh = useCallback(() => mutate(), [mutate])
  useEffect(() => {
    if (!enabled) return
    const changed = () => { void mutate() }
    const unsubscribe = subscribeToClientDataChanges(change => {
      if (change?.source === 'realtime:new-notification') changed()
    })
    for (const event of ['mira:reminder-created', 'mira:preferences-updated', 'mira:attention-changed']) window.addEventListener(event, changed)
    return () => { unsubscribe(); for (const event of ['mira:reminder-created', 'mira:preferences-updated', 'mira:attention-changed']) window.removeEventListener(event, changed) }
  }, [enabled, mutate])
  const update = useCallback(async (id, action, snoozeMinutes) => {
    const token = localStorage.getItem('token')
    const response = await fetch('/api/mira/proactive', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, ...(snoozeMinutes ? { snoozeMinutes } : {}) }) })
    const body = await response.json()
    if (localStorage.getItem('token') !== token) throw new Error('Account changed.')
    if (!response.ok || !body.success) throw new Error(body.message || 'Could not update this attention item.')
    if (action !== 'present') await mutate(current => current ? { ...current, events: current.events.filter(item => item.id !== id) } : current, { revalidate: false })
    return body.data
  }, [mutate])
  return { feed: enabled ? data : undefined, events: enabled ? data?.events || [] : [], error: enabled ? error : null, isLoading: enabled && isLoading, refresh, update }
}
