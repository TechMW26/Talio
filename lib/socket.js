import { initializeServerlessRealtime } from '@/lib/platform/realtimeIoAdapter.server'

// Compatibility facade for API publishers; delivery is owned by Pusher.
export const getIO = () => initializeServerlessRealtime()

export const emitToChat = (chatId, event, data) =>
  getIO()?.to(`chat:${chatId}`).emit(event, data) ?? false

export const emitToUser = (userId, event, data) =>
  getIO()?.to(`user:${userId}`).emit(event, data) ?? false

