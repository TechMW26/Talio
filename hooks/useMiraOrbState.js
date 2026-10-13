'use client'
import { useSyncExternalStore } from 'react'
import { MIRA_ORB_STATES } from '@/lib/miraOrbState'

const subscribers = new Set()
let voice = 'breathing', chat = 'breathing', snapshot = 'breathing'
function update(event) {
  const { source, state } = event.detail || {}
  if (!MIRA_ORB_STATES.includes(state) || !['voice', 'chat'].includes(source)) return
  if (source === 'voice') voice = state
  else chat = state
  // An authenticated tool's specific phase outranks the generic working mark.
  const next = voice === 'working' && chat !== 'breathing' ? chat : voice !== 'breathing' ? voice : chat
  if (snapshot !== next) { snapshot = next; subscribers.forEach(notify => notify()) }
}
function subscribe(notify) {
  if (!subscribers.size) window.addEventListener('mira:orb-state', update)
  subscribers.add(notify)
  return () => {
    subscribers.delete(notify)
    if (!subscribers.size) {
      window.removeEventListener('mira:orb-state', update)
      voice = chat = snapshot = 'breathing'
    }
  }
}
export default function useMiraOrbState() {
  return useSyncExternalStore(subscribe, () => snapshot, () => 'breathing')
}
