const LEGACY_MEETING_TRANSPORTS = new Set(['legacy', 'socket', 'socketio', 'socket.io'])

export function normalizeMeetingTransport(value) {
  return String(value || '').trim().toLocaleLowerCase()
}

export function usesManagedMeetingTransport(value = process.env.NEXT_PUBLIC_MEETING_TRANSPORT) {
  return !LEGACY_MEETING_TRANSPORTS.has(normalizeMeetingTransport(value))
}

export function getManagedMeetingJoinError(error) {
  if (error?.code === 'LIVEKIT_NOT_CONFIGURED') {
    return 'Talio Meet is temporarily unavailable. Ask an administrator to configure the meeting service.'
  }
  if (error?.code === 'NETWORK_ERROR' || error instanceof TypeError) {
    return 'The meeting service could not be reached. Check your connection and try again.'
  }
  return error?.message || 'The meeting could not be joined. Please try again.'
}
