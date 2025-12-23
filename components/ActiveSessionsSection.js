'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'

export default function ActiveSessionsSection() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(null) // Session ID being revoked
  const [revokingAll, setRevokingAll] = useState(false)

  const fetchSessions = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch('/api/profile/sessions', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setSessions(data.sessions || [])
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const handleRevokeSession = async (sessionId) => {
    try {
      setRevoking(sessionId)
      const token = localStorage.getItem('token')

      const response = await fetch(`/api/profile/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()

      if (response.ok) {
        toast.success('Session revoked successfully')
        setSessions(sessions.filter((s) => s.id !== sessionId))
      } else {
        toast.error(data.error || 'Failed to revoke session')
      }
    } catch (error) {
      toast.error('Something went wrong')
    } finally {
      setRevoking(null)
    }
  }

  const handleRevokeAll = async () => {
    try {
      setRevokingAll(true)
      const token = localStorage.getItem('token')

      const response = await fetch('/api/profile/sessions', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()

      if (response.ok) {
        toast.success(data.message || 'All other sessions revoked')
        // Keep only current session
        setSessions(sessions.filter((s) => s.isCurrent))
      } else {
        toast.error(data.error || 'Failed to revoke sessions')
      }
    } catch (error) {
      toast.error('Something went wrong')
    } finally {
      setRevokingAll(false)
    }
  }

  const getDeviceIcon = (deviceInfo) => {
    if (!deviceInfo) return '🖥️'

    const deviceType = deviceInfo.deviceType?.toLowerCase() || ''
    
    if (deviceType.includes('desktop app')) return '💻'
    if (deviceType.includes('android')) return '📱'
    if (deviceType.includes('ios') || deviceType.includes('iphone') || deviceType.includes('ipad')) return '📱'
    if (deviceType.includes('mobile')) return '📱'
    if (deviceType.includes('tablet')) return '📱'
    
    // Browser-based
    const browser = deviceInfo.browser?.toLowerCase() || ''
    if (browser.includes('chrome')) return '🌐'
    if (browser.includes('firefox')) return '🦊'
    if (browser.includes('safari')) return '🧭'
    if (browser.includes('edge')) return '🌀'
    
    return '🖥️'
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    })
  }

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length

  if (loading) {
    return (
      <section className="bg-white rounded-3xl border border-slate-100 shadow-sm shadow-slate-900/5 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4 sm:mb-5">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">Active Sessions</h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Loading...</p>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="p-4 rounded-2xl bg-slate-50 border border-slate-100 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-slate-200" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-200 rounded w-32 mb-2" />
                  <div className="h-3 bg-slate-200 rounded w-48" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white rounded-3xl border border-slate-100 shadow-sm shadow-slate-900/5 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-5">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-slate-900">Active Sessions</h3>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage devices where you&apos;re currently logged in
          </p>
        </div>
        {otherSessionsCount > 0 && (
          <button
            onClick={handleRevokeAll}
            disabled={revokingAll}
            className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {revokingAll ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Logging out...
              </span>
            ) : (
              `Logout All Others (${otherSessionsCount})`
            )}
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-slate-500 text-sm">No active sessions found</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {sessions.map((session) => (
              <motion.div
                key={session.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className={`p-4 rounded-2xl border transition-colors ${
                  session.isCurrent
                    ? 'bg-gradient-to-br from-purple-50 to-violet-50 border-purple-200'
                    : 'bg-slate-50 border-slate-100 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Device Icon */}
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                      session.isCurrent ? 'bg-purple-100' : 'bg-white border border-slate-200'
                    }`}
                  >
                    {getDeviceIcon(session.deviceInfo)}
                  </div>

                  {/* Session Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 text-sm truncate">
                        {session.deviceInfo?.deviceType || 'Unknown Device'}
                      </span>
                      {session.isCurrent && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold text-purple-700 bg-purple-100 rounded-full">
                          THIS DEVICE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {session.deviceInfo?.browser || 'Unknown Browser'} on{' '}
                      {session.deviceInfo?.os || 'Unknown OS'}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                      {session.ipAddress && (
                        <span className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-slate-300 rounded-full" />
                          {session.ipAddress}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                        {formatDate(session.lastActivityAt)}
                      </span>
                    </div>
                  </div>

                  {/* Revoke Button */}
                  {!session.isCurrent && (
                    <button
                      onClick={() => handleRevokeSession(session.id)}
                      disabled={revoking === session.id}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red hover:bg-red-500 bg-white border border-slate-200 hover:border-red-500 rounded-lg transition-all disabled:opacity-50"
                    >
                      {revoking === session.id ? (
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        'Logout'
                      )}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Security Note */}
      <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100">
        <p className="text-xs text-amber-700">
          <strong>🔒 Security Tip:</strong> If you see a device you don&apos;t recognize, log it out
          immediately and consider changing your password.
        </p>
      </div>
    </section>
  )
}
