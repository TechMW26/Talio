// UI status only. MiraWakeSetup remains the sole wake microphone owner.
const initial = { status: 'unknown', owner: '', enable: null }
let snapshot = initial
const listeners = new Set()
export const getMiraWakeState = () => snapshot
export const getMiraWakeServerState = () => initial
export function subscribeMiraWake(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function publishMiraWakeState(next) {
  snapshot = next
  listeners.forEach(listener => listener())
}
