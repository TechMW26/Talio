'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'

/**
 * Hook to enable real-time dashboard updates
 * Automatically subscribes to relevant events and calls refresh callbacks
 * 
 * @param {Object} options - Configuration options
 * @param {Function} options.onAttendanceUpdate - Callback when attendance changes
 * @param {Function} options.onLeaveUpdate - Callback when leave status changes
 * @param {Function} options.onExpenseUpdate - Callback when expense status changes
 * @param {Function} options.onProjectUpdate - Callback when project changes
 * @param {Function} options.onTaskUpdate - Callback when task changes
 * @param {Function} options.onEmployeeUpdate - Callback when employee changes
 * @param {Function} options.onAnnouncementUpdate - Callback when announcement changes
 * @param {Function} options.onMeetingUpdate - Callback when meeting changes
 * @param {Function} options.onDashboardRefresh - Callback for general refresh
 * @param {Function} options.onHolidayUpdate - Callback when holiday changes
 * @param {string[]} options.subscribeToEvents - Array of event names to subscribe to (optional)
 */
export function useRealtimeDashboard({
  onAttendanceUpdate,
  onLeaveUpdate,
  onExpenseUpdate,
  onProjectUpdate,
  onTaskUpdate,
  onEmployeeUpdate,
  onAnnouncementUpdate,
  onMeetingUpdate,
  onDashboardRefresh,
  onHolidayUpdate,
  subscribeToEvents = []
} = {}) {
  const { 
    socket, 
    isConnected,
    subscribe,
    onAttendanceUpdate: socketOnAttendanceUpdate,
    onLeaveStatusUpdate,
    onLeaveRequest,
    onExpenseStatusUpdate,
    onProjectCreated,
    onProjectUpdated,
    onTaskCreated,
    onTaskStatusChanged,
    onTaskUpdated,
    onEmployeeCreated,
    onEmployeeUpdated,
    onAnnouncementUpdate: socketOnAnnouncementUpdate,
    onMeetingUpdate: socketOnMeetingUpdate,
    onDashboardRefresh: socketOnDashboardRefresh,
    onHolidayUpdate: socketOnHolidayUpdate
  } = useSocket()

  // Use refs to store callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef({
    onAttendanceUpdate,
    onLeaveUpdate,
    onExpenseUpdate,
    onProjectUpdate,
    onTaskUpdate,
    onEmployeeUpdate,
    onAnnouncementUpdate,
    onMeetingUpdate,
    onDashboardRefresh,
    onHolidayUpdate
  })

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onAttendanceUpdate,
      onLeaveUpdate,
      onExpenseUpdate,
      onProjectUpdate,
      onTaskUpdate,
      onEmployeeUpdate,
      onAnnouncementUpdate,
      onMeetingUpdate,
      onDashboardRefresh,
      onHolidayUpdate
    }
  }, [
    onAttendanceUpdate, 
    onLeaveUpdate, 
    onExpenseUpdate, 
    onProjectUpdate, 
    onTaskUpdate, 
    onEmployeeUpdate,
    onAnnouncementUpdate,
    onMeetingUpdate,
    onDashboardRefresh,
    onHolidayUpdate
  ])

  useEffect(() => {
    if (!socket || !isConnected) return

    const unsubscribers = []

    // Attendance updates
    if (callbacksRef.current.onAttendanceUpdate) {
      const unsub = socketOnAttendanceUpdate((data) => {
        console.log('📡 [Realtime] Attendance update received:', data)
        callbacksRef.current.onAttendanceUpdate?.(data)
      })
      if (unsub) unsubscribers.push(unsub)
    }

    // Leave updates
    if (callbacksRef.current.onLeaveUpdate) {
      const unsub1 = onLeaveStatusUpdate((data) => {
        console.log('📡 [Realtime] Leave status update received:', data)
        callbacksRef.current.onLeaveUpdate?.(data)
      })
      const unsub2 = onLeaveRequest((data) => {
        console.log('📡 [Realtime] Leave request received:', data)
        callbacksRef.current.onLeaveUpdate?.(data)
      })
      if (unsub1) unsubscribers.push(unsub1)
      if (unsub2) unsubscribers.push(unsub2)
    }

    // Expense updates
    if (callbacksRef.current.onExpenseUpdate) {
      const unsub = onExpenseStatusUpdate((data) => {
        console.log('📡 [Realtime] Expense update received:', data)
        callbacksRef.current.onExpenseUpdate?.(data)
      })
      if (unsub) unsubscribers.push(unsub)
    }

    // Project updates
    if (callbacksRef.current.onProjectUpdate) {
      const unsub1 = onProjectCreated((data) => {
        console.log('📡 [Realtime] Project created received:', data)
        callbacksRef.current.onProjectUpdate?.(data)
      })
      const unsub2 = onProjectUpdated((data) => {
        console.log('📡 [Realtime] Project updated received:', data)
        callbacksRef.current.onProjectUpdate?.(data)
      })
      if (unsub1) unsubscribers.push(unsub1)
      if (unsub2) unsubscribers.push(unsub2)
    }

    // Task updates
    if (callbacksRef.current.onTaskUpdate) {
      const unsub1 = onTaskCreated((data) => {
        console.log('📡 [Realtime] Task created received:', data)
        callbacksRef.current.onTaskUpdate?.(data)
      })
      const unsub2 = onTaskStatusChanged((data) => {
        console.log('📡 [Realtime] Task status changed received:', data)
        callbacksRef.current.onTaskUpdate?.(data)
      })
      const unsub3 = onTaskUpdated?.((data) => {
        console.log('📡 [Realtime] Task updated received:', data)
        callbacksRef.current.onTaskUpdate?.(data)
      })
      if (unsub1) unsubscribers.push(unsub1)
      if (unsub2) unsubscribers.push(unsub2)
      if (unsub3) unsubscribers.push(unsub3)
    }

    // Employee updates
    if (callbacksRef.current.onEmployeeUpdate) {
      const unsub1 = onEmployeeCreated((data) => {
        console.log('📡 [Realtime] Employee created received:', data)
        callbacksRef.current.onEmployeeUpdate?.(data)
      })
      const unsub2 = onEmployeeUpdated((data) => {
        console.log('📡 [Realtime] Employee updated received:', data)
        callbacksRef.current.onEmployeeUpdate?.(data)
      })
      if (unsub1) unsubscribers.push(unsub1)
      if (unsub2) unsubscribers.push(unsub2)
    }

    // Announcement updates
    if (callbacksRef.current.onAnnouncementUpdate) {
      const unsub = socketOnAnnouncementUpdate?.((data) => {
        console.log('📡 [Realtime] Announcement update received:', data)
        callbacksRef.current.onAnnouncementUpdate?.(data)
      })
      if (unsub) unsubscribers.push(unsub)
    }

    // Meeting updates
    if (callbacksRef.current.onMeetingUpdate) {
      const unsub = socketOnMeetingUpdate?.((data) => {
        console.log('📡 [Realtime] Meeting update received:', data)
        callbacksRef.current.onMeetingUpdate?.(data)
      })
      if (unsub) unsubscribers.push(unsub)
    }

    // Dashboard refresh
    if (callbacksRef.current.onDashboardRefresh) {
      const unsub = socketOnDashboardRefresh?.((data) => {
        console.log('📡 [Realtime] Dashboard refresh received:', data)
        callbacksRef.current.onDashboardRefresh?.(data)
      })
      if (unsub) unsubscribers.push(unsub)
    }

    // Holiday updates
    if (callbacksRef.current.onHolidayUpdate) {
      const unsub = socketOnHolidayUpdate?.((data) => {
        console.log('📡 [Realtime] Holiday update received:', data)
        callbacksRef.current.onHolidayUpdate?.(data)
      })
      if (unsub) unsubscribers.push(unsub)
    }

    // Custom event subscriptions
    subscribeToEvents.forEach(eventName => {
      const unsub = subscribe(eventName, (data) => {
        console.log(`📡 [Realtime] Custom event ${eventName} received:`, data)
      })
      if (unsub) unsubscribers.push(unsub)
    })

    // Cleanup
    return () => {
      unsubscribers.forEach(unsub => {
        if (typeof unsub === 'function') unsub()
      })
    }
  }, [socket, isConnected]) // Only re-subscribe when socket connection changes

  return {
    isConnected,
    REALTIME_EVENTS
  }
}

export default useRealtimeDashboard
